const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { randomUUID } = require("crypto");

const dotenv = require("dotenv");

dotenv.config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("ideavolt");
    const ideaCollection = db.collection("ideas");
    const myIdeaCollection = db.collection("my-ideas");

    // app.get("/ideas", async (req, res) => {
    //   const result = await ideaCollection.find().toArray();
    //   res.send(result);
    // });
    

app.get("/ideas", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) ;

    const pipeline = [
      {$sort: {_id:-1} }
    ]
    if(!isNaN(limit)){
      pipeline.push({$limit:limit})
    }

    const result = await ideaCollection
      .aggregate(pipeline)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});



    app.post("/ideas", async (req, res) => {
      const ideaData = req.body;
      console.log(ideaData);
      const result = await ideaCollection.insertOne(ideaData);

      res.json(result);
    });

    app.get("/ideas/:id", async (req, res) => {
      const { id } = req.params;

      const result = await ideaCollection.findOne({ _id: new ObjectId(id) });

      res.send(result);
    });

// comment get,add, update, delete added start
app.get("/ideas/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;

    const idea = await ideaCollection.findOne(
      { _id: new ObjectId(id) },
      { projection: { comments: 1 } }
    );

    res.send(idea?.comments || []);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});
//post add
app.post("/ideas/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;

    const { userName, photoURL, text } = req.body;

    const comment = {
      _id: randomUUID(),
      userName,
      photoURL: photoURL || "",
      text,
      createdAt: new Date(),
    };

    await ideaCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $push: {
          comments: comment,
        },
      }
    );

    res.send(comment);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

//update
app.patch("/ideas/:ideaId/comments/:commentId", async (req, res) => {
  try {
    const { ideaId, commentId } = req.params;

    const { text } = req.body;

    await ideaCollection.updateOne(
      {
        _id: new ObjectId(ideaId),
        "comments._id": commentId,
      },
      {
        $set: {
          "comments.$.text": text,
        },
      }
    );

    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});
//delete
app.delete("/ideas/:ideaId/comments/:commentId", async (req, res) => {
  try {
    const { ideaId, commentId } = req.params;

    await ideaCollection.updateOne(
      { _id: new ObjectId(ideaId) },
      {
        $pull: {
          comments: {
            _id: commentId,
          },
        },
      }
    );

    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});


// comment get,add, update, delete added end



    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running super!!!");
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
