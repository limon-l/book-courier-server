const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://book-courier-client.web.app",
      "https://book-courier-client.firebaseapp.com",
      "https://lighthouselibrary.vercel.app",
    ],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.u3nnjnr.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const userCollection = client.db("bookCourierDb").collection("users");
    const bookCollection = client.db("bookCourierDb").collection("books");
    const orderCollection = client.db("bookCourierDb").collection("orders");
    const paymentCollection = client.db("bookCourierDb").collection("payments");
    const wishlistCollection = client
      .db("bookCourierDb")
      .collection("wishlist");
    const reviewCollection = client.db("bookCourierDb").collection("reviews");

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "2h",
      });
      res.send({ token });
    });

    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyLibrarian = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });
      const isLibrarian = user?.role === "librarian";
      if (!isLibrarian) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const user = await userCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: "admin" } };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.patch(
      "/users/librarian/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: "librarian" } };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.get("/books", async (req, res) => {
      const filter = req.query.category ? { category: req.query.category } : {};

      if (req.query.search) {
        filter.$or = [
          { title: { $regex: req.query.search, $options: "i" } },
          { author: { $regex: req.query.search, $options: "i" } },
        ];
      }

      filter.status = "published";

      let sortOptions = {};
      if (req.query.sort === "price-asc") sortOptions = { price: 1 };
      if (req.query.sort === "price-desc") sortOptions = { price: -1 };

      const result = await bookCollection
        .find(filter)
        .sort(sortOptions)
        .toArray();
      res.send(result);
    });

    app.get("/books/admin", verifyToken, verifyAdmin, async (req, res) => {
      const result = await bookCollection.find().toArray();
      res.send(result);
    });

    app.get(
      "/books/librarian/:email",
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req.decoded.email)
          return res.status(403).send({ message: "forbidden" });
        const query = { librarianEmail: email };
        const result = await bookCollection.find(query).toArray();
        res.send(result);
      }
    );
    app.get("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid Book ID format" });
        }
        const result = await bookCollection.findOne({ _id: new ObjectId(id) });
        if (!result) return res.status(404).send({ message: "Book not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/books", verifyToken, verifyLibrarian, async (req, res) => {
      const result = await bookCollection.insertOne(req.body);
      res.send(result);
    });

    app.patch("/books/:id", verifyToken, verifyLibrarian, async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          title: item.title,
          category: item.category,
          price: item.price,
          author: item.author,
          image: item.image,
          rating: item.rating,
          status: item.status,
        },
      };
      const result = await bookCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/books/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await bookCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.patch(
      "/books/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const result = await bookCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status } }
        );
        res.send(result);
      }
    );
    app.get("/orders", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email)
        return res.status(403).send({ message: "forbidden" });
      const result = await orderCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });
    app.get("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid Order ID" });
      }
      const result = await orderCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get(
      "/orders/librarian/:email",
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req.decoded.email)
          return res.status(403).send({ message: "forbidden" });
        const result = await orderCollection
          .find({ librarianEmail: email })
          .toArray();
        res.send(result);
      }
    );

    app.post("/orders", verifyToken, async (req, res) => {
      const result = await orderCollection.insertOne(req.body);
      res.send(result);
    });

    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const result = await orderCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    app.patch(
      "/orders/status/:id",
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const result = await orderCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status } }
        );
        res.send(result);
      }
    );

    app.get("/wishlist", verifyToken, async (req, res) => {
      const result = await wishlistCollection
        .find({ email: req.query.email })
        .toArray();
      res.send(result);
    });

    app.post("/wishlist", verifyToken, async (req, res) => {
      const result = await wishlistCollection.insertOne(req.body);
      res.send(result);
    });

    app.delete("/wishlist/:id", verifyToken, async (req, res) => {
      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    app.get("/reviews/:bookId", async (req, res) => {
      const result = await reviewCollection
        .find({ bookId: req.params.bookId })
        .toArray();
      res.send(result);
    });

    app.post("/reviews", verifyToken, async (req, res) => {
      const result = await reviewCollection.insertOne(req.body);
      res.send(result);
    });

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get("/payments", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email)
        return res.status(403).send({ message: "forbidden access" });
      const result = await paymentCollection.find({ email }).toArray();
      res.send(result);
    });

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      const deleteResult = await orderCollection.updateOne(
        { _id: new ObjectId(payment.orderId) },
        { $set: { paymentStatus: "paid", status: "pending" } }
      );

      const bookUpdate = await bookCollection.updateOne(
        { _id: new ObjectId(payment.bookId) },
        { $inc: { quantity: -1 } }
      );

      res.send({ paymentResult, deleteResult, bookUpdate });
    });

    app.get("/", (req, res) => {
      res.send("BookCourier server is running");
    });
  } finally {
  }
}
run().catch(console.dir);

// port
app.listen(port, () => {
  console.log(`BookCourier is running on port ${port}`);
});
