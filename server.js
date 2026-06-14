import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import RunwayML from "@runwayml/sdk";

dotenv.config();

const app = express();
const requiredEnv = ["RUNWAYML_API_SECRET", "ACTION_SECRET"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
const requestCounts = new Map();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

if (missingEnv.length) {
  console.warn(`Missing environment variables: ${missingEnv.join(", ")}`);
}

const client = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET,
});

function rateLimit(req, res, next) {
  const windowMs = 60 * 1000;
  const maxRequests = Number(process.env.RATE_LIMIT_PER_MINUTE || 20);
  const now = Date.now();
  const key = req.ip || req.header("x-forwarded-for") || "unknown";
  const current = requestCounts.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }

  current.count += 1;
  requestCounts.set(key, current);

  if (current.count > maxRequests) {
    return res.status(429).json({
      ok: false,
      error: "Too many requests",
      message: "Please wait before sending another generation request.",
    });
  }

  next();
}

function requireActionSecret(req, res, next) {
  const secret = req.header("x-action-secret");

  if (!process.env.ACTION_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Server is missing ACTION_SECRET",
    });
  }

  if (!secret || secret !== process.env.ACTION_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
      message: "Missing or invalid x-action-secret",
    });
  }

  next();
}

function handleRunwayError(res, error, fallbackMessage) {
  const status = error.status || error.statusCode || 500;

  console.error(fallbackMessage, {
    message: error.message,
    status,
    name: error.name,
  });

  res.status(status >= 400 && status < 600 ? status : 500).json({
    ok: false,
    error: error.message || fallbackMessage,
  });
}

function getTaskId(task) {
  return task?.id || task?.taskId || task?.task_id || task?.job_id || null;
}

function getOutputUrls(task) {
  if (!task?.output) {
    return [];
  }

  if (Array.isArray(task.output)) {
    return task.output
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.url || item?.uri || item?.video_url || item?.image_url || null;
      })
      .filter(Boolean);
  }

  if (typeof task.output === "string") {
    return [task.output];
  }

  return [task.output.url, task.output.uri, task.output.video_url, task.output.image_url].filter(Boolean);
}

function normalizeStatus(status) {
  const value = String(status || "submitted").toLowerCase();

  if (["succeeded", "success", "completed", "complete"].includes(value)) {
    return "completed";
  }

  if (["failed", "failure", "cancelled", "canceled"].includes(value)) {
    return "failed";
  }

  if (["running", "processing", "pending", "queued", "submitted", "throttled"].includes(value)) {
    return "processing";
  }

  return value;
}

function publicTaskResponse(task) {
  const taskId = getTaskId(task);
  const outputUrls = getOutputUrls(task);
  const status = normalizeStatus(task?.status);
  const videoUrl = outputUrls.find((url) => /\.(mp4|mov|webm)(\?|$)/i.test(url)) || outputUrls[0] || null;

  return {
    ok: true,
    status,
    raw_status: task?.status || null,
    task_id: taskId,
    taskId,
    job_id: taskId,
    video_url: videoUrl,
    output: outputUrls,
    message: videoUrl
      ? "Runway task completed. The generated asset URL is available in video_url."
      : taskId
        ? "Runway task submitted or still processing. Save task_id and query /get-task/{task_id} later."
        : "Runway response did not include a task ID or output URL. Check Runway API response and permissions.",
    task,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrieveTask(taskId) {
  return client.tasks.retrieve(taskId);
}

async function waitForTask(taskId, maxWaitSeconds = 45) {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let latestTask = await retrieveTask(taskId);

  while (Date.now() < deadline) {
    const response = publicTaskResponse(latestTask);

    if (response.status === "completed" || response.status === "failed") {
      return latestTask;
    }

    await sleep(5000);
    latestTask = await retrieveTask(taskId);
  }

  return latestTask;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "shalonghui-runway-backend",
    endpoints: ["/health", "/generate-video", "/generate-video-and-wait", "/generate-image", "/get-task/:taskId"],
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "shalonghui-runway-backend",
  });
});

app.post("/generate-video", rateLimit, requireActionSecret, async (req, res) => {
  try {
    const {
      promptText,
      promptImage,
      model = "gen4.5",
      ratio = "720:1280",
      duration = 5,
    } = req.body;

    if (!promptText) {
      return res.status(400).json({
        ok: false,
        error: "promptText is required",
      });
    }

    const payload = {
      model,
      promptText,
      ratio,
      duration,
    };

    const task = promptImage
      ? await client.imageToVideo.create({ ...payload, promptImage })
      : await client.textToVideo.create(payload);

    res.json(publicTaskResponse(task));
  } catch (error) {
    handleRunwayError(res, error, "Runway video generation failed");
  }
});

app.post("/generate-video-and-wait", rateLimit, requireActionSecret, async (req, res) => {
  try {
    const {
      promptText,
      promptImage,
      model = "gen4.5",
      ratio = "720:1280",
      duration = 5,
      maxWaitSeconds = 45,
    } = req.body;

    if (!promptText) {
      return res.status(400).json({
        ok: false,
        error: "promptText is required",
      });
    }

    const payload = {
      model,
      promptText,
      ratio,
      duration,
    };

    const createdTask = promptImage
      ? await client.imageToVideo.create({ ...payload, promptImage })
      : await client.textToVideo.create(payload);

    const taskId = getTaskId(createdTask);

    if (!taskId) {
      return res.json(publicTaskResponse(createdTask));
    }

    const safeWaitSeconds = Math.max(0, Math.min(Number(maxWaitSeconds) || 45, 90));
    const latestTask = safeWaitSeconds > 0
      ? await waitForTask(taskId, safeWaitSeconds)
      : createdTask;

    res.json(publicTaskResponse(latestTask));
  } catch (error) {
    handleRunwayError(res, error, "Runway video generation failed");
  }
});

app.post("/generate-image", rateLimit, requireActionSecret, async (req, res) => {
  try {
    const {
      promptText,
      model = "gen4_image",
      ratio = "1080:1920",
      referenceImages,
    } = req.body;

    if (!promptText) {
      return res.status(400).json({
        ok: false,
        error: "promptText is required",
      });
    }

    const payload = {
      model,
      promptText,
      ratio,
    };

    if (referenceImages) {
      payload.referenceImages = referenceImages;
    }

    const task = await client.textToImage.create(payload);

    res.json(publicTaskResponse(task));
  } catch (error) {
    handleRunwayError(res, error, "Runway image generation failed");
  }
});

app.get("/get-task/:taskId", rateLimit, requireActionSecret, async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        ok: false,
        error: "taskId is required",
      });
    }

    const task = await client.tasks.retrieve(taskId);

    res.json(publicTaskResponse(task));
  } catch (error) {
    handleRunwayError(res, error, "Failed to retrieve Runway task");
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Runway backend running on port ${port}`);
});
