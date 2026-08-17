const dns = require("node:dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { randomUUID } = require("crypto");
const dotenv = require("dotenv");

dotenv.config();

const express = require("express");
const cors = require("cors");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

// ========================================
// ENVIRONMENT
// ========================================

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI is missing from .env");
  process.exit(1);
}

const app = express();

const PORT = process.env.PORT || 5000;

const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || `${process.env.CLIENT_URL}`;

// ========================================
// MIDDLEWARE
// ========================================

app.use(
  cors({
    origin: `${process.env.CLIENT_URL}`,
    credentials: true,
  }),
);

app.use(express.json());

// ========================================
// MONGODB
// ========================================

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ========================================
// BETTER AUTH JWKS
// ========================================

const JWKS = createRemoteJWKSet(new URL(`${BETTER_AUTH_URL}/api/auth/jwks`));

// ========================================
// VERIFY BETTER AUTH JWT
// ========================================

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    console.log("================================");
    console.log("AUTH HEADER:", authHeader);
    console.log("================================");

    // ------------------------------------
    // Authorization header missing
    // ------------------------------------

    if (!authHeader) {
      return res.status(401).json({
        message: "Unauthorized: No authorization header",
      });
    }

    // ------------------------------------
    // Check Bearer token
    // ------------------------------------

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        message: "Unauthorized: Invalid Bearer token",
      });
    }

    // ------------------------------------
    // Verify JWT
    // ------------------------------------

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: BETTER_AUTH_URL,
      audience: BETTER_AUTH_URL,
    });

    console.log("JWT PAYLOAD:", payload);

    // ------------------------------------
    // Save authenticated user
    // ------------------------------------

    req.user = payload;

    next();
  } catch (error) {
    console.error("================================");
    console.error("JWT VERIFY ERROR:", error);
    console.error("================================");

    return res.status(403).json({
      message: "Forbidden",
      error: error.message,
    });
  }
};

// ========================================
// DATABASE
// ========================================

async function run() {
  try {
    // ====================================
    // CONNECT MONGODB
    // ====================================

    // await client.connect();

    const db = client.db("ideavolt");

    const ideaCollection = db.collection("ideas");

    // ====================================
    // GET ALL IDEAS
    // Public route
    // ====================================

    app.get("/ideas", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit);

        const pipeline = [
          {
            $sort: {
              _id: -1,
            },
          },
        ];

        if (!isNaN(limit) && limit > 0) {
          pipeline.push({
            $limit: limit,
          });
        }

        const result = await ideaCollection.aggregate(pipeline).toArray();

        res.status(200).json(result);
      } catch (error) {
        console.error("GET IDEAS ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // ADD IDEA
    // Protected route
    // ====================================

    app.post("/ideas", verifyToken, async (req, res) => {
      try {
        const ideaData = {
          ...req.body,
        };

        // --------------------------------
        // Get authenticated user
        // --------------------------------

        const userId = req.user.sub;
        const userEmail = req.user.email;
        const userName = req.user.name || "User";
        const userImage = req.user.image || "";

        // --------------------------------
        // Add authenticated user info
        // --------------------------------

        ideaData.postedBy = userName;
        ideaData.postedByEmail = userEmail;
        ideaData.postedById = userId;
        ideaData.postedByImage = userImage;

        ideaData.createdAt = ideaData.createdAt || new Date();

        const result = await ideaCollection.insertOne(ideaData);

        res.status(201).json({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("ADD IDEA ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // GET SINGLE IDEA
    // Protected route
    // ====================================

    app.get("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid idea ID",
          });
        }

        const result = await ideaCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).json({
            message: "Idea not found",
          });
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("GET SINGLE IDEA ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // GET MY IDEAS
    // Protected route
    // ====================================

    app.get("/my-ideas", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;

        if (!email) {
          return res.status(400).json({
            message: "User email not found",
          });
        }

        const result = await ideaCollection
          .find({
            postedByEmail: email,
          })
          .sort({
            _id: -1,
          })
          .toArray();

        res.status(200).json(result);
      } catch (error) {
        console.error("GET MY IDEAS ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // UPDATE IDEA
    // Protected route
    // ====================================

    app.patch("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid idea ID",
          });
        }

        const existingIdea = await ideaCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!existingIdea) {
          return res.status(404).json({
            message: "Idea not found",
          });
        }

        // --------------------------------
        // Only owner can update
        // --------------------------------

        if (existingIdea.postedByEmail !== req.user.email) {
          return res.status(403).json({
            message: "You are not allowed to update this idea",
          });
        }

        // --------------------------------
        // Copy update data
        // --------------------------------

        const updateData = {
          ...req.body,
        };

        // --------------------------------
        // Prevent changing protected fields
        // --------------------------------

        delete updateData._id;
        delete updateData.postedByEmail;
        delete updateData.postedBy;
        delete updateData.postedById;
        delete updateData.postedByImage;
        delete updateData.createdAt;
        delete updateData.comments;

        // --------------------------------
        // Update
        // --------------------------------

        const result = await ideaCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: updateData,
          },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Idea not found",
          });
        }

        res.status(200).json({
          success: true,
          message: "Idea updated successfully",
        });
      } catch (error) {
        console.error("UPDATE IDEA ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // DELETE IDEA
    // Protected route
    // ====================================

    app.delete("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid idea ID",
          });
        }

        const existingIdea = await ideaCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!existingIdea) {
          return res.status(404).json({
            message: "Idea not found",
          });
        }

        // --------------------------------
        // Only owner can delete
        // --------------------------------

        if (existingIdea.postedByEmail !== req.user.email) {
          return res.status(403).json({
            message: "You are not allowed to delete this idea",
          });
        }

        await ideaCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.status(200).json({
          success: true,
          message: "Idea deleted successfully",
        });
      } catch (error) {
        console.error("DELETE IDEA ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // GET COMMENTS
    // Public route
    // ====================================

    app.get("/ideas/:id/comments", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid idea ID",
          });
        }

        const idea = await ideaCollection.findOne(
          {
            _id: new ObjectId(id),
          },
          {
            projection: {
              comments: 1,
            },
          },
        );

        if (!idea) {
          return res.status(404).json({
            message: "Idea not found",
          });
        }

        res.status(200).json(idea.comments || []);
      } catch (error) {
        console.error("GET COMMENTS ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // ADD COMMENT
    // Protected route
    // ====================================

    app.post("/ideas/:id/comments", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid idea ID",
          });
        }

        const { text } = req.body;

        // --------------------------------
        // Validate comment
        // --------------------------------

        if (!text?.trim()) {
          return res.status(400).json({
            message: "Comment text is required.",
          });
        }

        // --------------------------------
        // Get user ONLY from JWT
        // --------------------------------

        const userId = req.user.sub;
        const userName = req.user.name || "User";
        const photoURL = req.user.image || "";

        if (!userId) {
          return res.status(401).json({
            message: "Authenticated user ID not found.",
          });
        }

        // --------------------------------
        // Create comment
        // --------------------------------

        const comment = {
          _id: randomUUID(),
          userId,
          userName,
          photoURL,
          text: text.trim(),
          createdAt: new Date(),
        };

        // --------------------------------
        // Add comment
        // --------------------------------

        const result = await ideaCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $push: {
              comments: comment,
            },
          },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Idea not found.",
          });
        }

        res.status(201).json(comment);
      } catch (error) {
        console.error("ADD COMMENT ERROR:", error);

        res.status(500).json({
          message: error.message,
        });
      }
    });

    // ====================================
    // UPDATE COMMENT
    // Protected route
    // ====================================

    app.patch(
      "/ideas/:ideaId/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { ideaId, commentId } = req.params;

          if (!ObjectId.isValid(ideaId)) {
            return res.status(400).json({
              message: "Invalid idea ID",
            });
          }

          const { text } = req.body;

          if (!text?.trim()) {
            return res.status(400).json({
              message: "Comment text is required.",
            });
          }

          // --------------------------------
          // User comes from JWT
          // --------------------------------

          const userId = req.user.sub;

          // --------------------------------
          // Update only own comment
          // --------------------------------

          const result = await ideaCollection.updateOne(
            {
              _id: new ObjectId(ideaId),
              comments: {
                $elemMatch: {
                  _id: commentId,
                  userId: userId,
                },
              },
            },
            {
              $set: {
                "comments.$.text": text.trim(),
              },
            },
          );

          if (result.matchedCount === 0) {
            return res.status(403).json({
              message: "You are not allowed to edit this comment.",
            });
          }

          res.status(200).json({
            success: true,
            message: "Comment updated successfully.",
          });
        } catch (error) {
          console.error("UPDATE COMMENT ERROR:", error);

          res.status(500).json({
            message: error.message,
          });
        }
      },
    );

    // ====================================
    // DELETE COMMENT
    // Protected route
    // ====================================

    app.delete(
      "/ideas/:ideaId/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { ideaId, commentId } = req.params;

          if (!ObjectId.isValid(ideaId)) {
            return res.status(400).json({
              message: "Invalid idea ID",
            });
          }

          // --------------------------------
          // User comes from JWT
          // --------------------------------

          const userId = req.user.sub;

          // --------------------------------
          // Delete only own comment
          // --------------------------------

          const result = await ideaCollection.updateOne(
            {
              _id: new ObjectId(ideaId),
              comments: {
                $elemMatch: {
                  _id: commentId,
                  userId: userId,
                },
              },
            },
            {
              $pull: {
                comments: {
                  _id: commentId,
                  userId: userId,
                },
              },
            },
          );

          if (result.matchedCount === 0) {
            return res.status(403).json({
              message: "You are not allowed to delete this comment.",
            });
          }

          res.status(200).json({
            success: true,
            message: "Comment deleted successfully.",
          });
        } catch (error) {
          console.error("DELETE COMMENT ERROR:", error);

          res.status(500).json({
            message: error.message,
          });
        }
      },
    );

    // ====================================
    // MONGODB TEST
    // ====================================

    // await client.db("admin").command({
    //   ping: 1,
    // });

    console.log("MongoDB connected successfully!");
  } catch (error) {
    console.error("DATABASE CONNECTION ERROR:", error);

    process.exit(1);
  }
}

// ========================================
// ROOT
// ========================================

app.get("/", (req, res) => {
  res.send("IdeaVolt Server is running!");
});

// ========================================
// START SERVER
// ========================================

run();

app.listen(PORT, () => {
  console.log(`IdeaVolt Server is running on port ${PORT}`);
});
