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

function publicTaskResponse(task) {
  return {
    ok: true,
    taskId: task.id,
    status: task.status,
    output: task.output,
    task,
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "shalonghui-runway-backend",
    endpoints: ["/health", "/generate-video", "/generate-image", "/get-task/:taskId"],
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

    if (promptImage) {
      payload.promptImage = promptImage;
    }

    const task = await client.imageToVideo.create(payload);

    res.json(publicTaskResponse(task));
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
