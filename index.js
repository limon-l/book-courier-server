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

let db;

async function connectDB() {
  if (db) return db;
  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
    }
    db = client.db("bookCourierDb");
    return db;
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    throw error;
  }
}

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
  try {
    const email = req.decoded.email;
    const database = await connectDB();
    const user = await database.collection("users").findOne({ email });
    const isAdmin = user?.role === "admin";
    if (!isAdmin) {
      return res.status(403).send({ message: "forbidden access" });
    }
    next();
  } catch (error) {
    res.status(500).send({ message: "Middleware Error" });
  }
};

const verifyLibrarian = async (req, res, next) => {
  try {
    const email = req.decoded.email;
    const database = await connectDB();
    const user = await database.collection("users").findOne({ email });
    const isLibrarian = user?.role === "librarian" || user?.role === "admin";
    if (!isLibrarian) {
      return res.status(403).send({ message: "forbidden access" });
    }
    next();
  } catch (error) {
    res.status(500).send({ message: "Middleware Error" });
  }
};

app.get("/", (req, res) => {
  res.send("BookCourier server is running");
});

app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "2h",
  });
  res.send({ token });
});

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const database = await connectDB();
  const result = await database.collection("users").find().toArray();
  res.send(result);
});

app.get("/users/role/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const database = await connectDB();
  const user = await database.collection("users").findOne({ email });
  res.send({ role: user?.role || "user" });
});

app.post("/users", async (req, res) => {
  const user = req.body;
  const database = await connectDB();
  const existingUser = await database
    .collection("users")
    .findOne({ email: user.email });
  if (existingUser) {
    return res.send({ message: "user already exists", insertedId: null });
  }
  const result = await database.collection("users").insertOne(user);
  res.send(result);
});

app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("users")
    .updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role: "admin" } }
    );
  res.send(result);
});

app.patch(
  "/users/librarian/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const database = await connectDB();
    const result = await database
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role: "librarian" } }
      );
    res.send(result);
  }
);

app.get("/books", async (req, res) => {
  try {
    const database = await connectDB();
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

    const result = await database
      .collection("books")
      .find(filter)
      .sort(sortOptions)
      .toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Error fetching books" });
  }
});

app.get("/books/admin", verifyToken, verifyAdmin, async (req, res) => {
  const database = await connectDB();
  const result = await database.collection("books").find().toArray();
  res.send(result);
});

app.get(
  "/books/librarian/:email",
  verifyToken,
  verifyLibrarian,
  async (req, res) => {
    const database = await connectDB();
    const requester = await database
      .collection("users")
      .findOne({ email: req.decoded.email });

    let query = {};

    if (requester?.role === "admin") {
      query = {};
    } else {
      if (req.params.email !== req.decoded.email)
        return res.status(403).send({ message: "forbidden" });
      query = { librarianEmail: req.params.email };
    }

    const result = await database.collection("books").find(query).toArray();
    res.send(result);
  }
);

app.get("/books/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid ID" });
    const database = await connectDB();
    const result = await database
      .collection("books")
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!result) return res.status(404).send({ message: "Not found" });
    res.send(result);
  } catch (e) {
    res.status(500).send({ message: "Error" });
  }
});

app.post("/books", verifyToken, verifyLibrarian, async (req, res) => {
  const database = await connectDB();
  const result = await database.collection("books").insertOne(req.body);
  res.send(result);
});

app.patch("/books/:id", verifyToken, verifyLibrarian, async (req, res) => {
  const database = await connectDB();
  const item = req.body;
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
  const result = await database
    .collection("books")
    .updateOne({ _id: new ObjectId(req.params.id) }, updatedDoc);
  res.send(result);
});

app.delete("/books/:id", verifyToken, verifyAdmin, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("books")
    .deleteOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
});

app.patch("/books/status/:id", verifyToken, verifyAdmin, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("books")
    .updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: req.body.status } }
    );
  res.send(result);
});

app.get("/orders", verifyToken, async (req, res) => {
  if (req.query.email !== req.decoded.email)
    return res.status(403).send({ message: "forbidden" });
  const database = await connectDB();
  const result = await database
    .collection("orders")
    .find({ userEmail: req.query.email })
    .toArray();
  res.send(result);
});

app.get("/orders/:id", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id))
    return res.status(400).send({ message: "Invalid ID" });
  const database = await connectDB();
  const result = await database
    .collection("orders")
    .findOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
});

app.get(
  "/orders/librarian/:email",
  verifyToken,
  verifyLibrarian,
  async (req, res) => {
    const database = await connectDB();
    const requester = await database
      .collection("users")
      .findOne({ email: req.decoded.email });

    let query = {};

    if (requester?.role === "admin") {
      query = {};
    } else {
      if (req.params.email !== req.decoded.email)
        return res.status(403).send({ message: "forbidden" });
      query = { librarianEmail: req.params.email };
    }

    const result = await database.collection("orders").find(query).toArray();
    res.send(result);
  }
);

app.post("/orders", verifyToken, async (req, res) => {
  const database = await connectDB();
  const result = await database.collection("orders").insertOne(req.body);
  res.send(result);
});

app.delete("/orders/:id", verifyToken, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("orders")
    .deleteOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
});

app.patch(
  "/orders/status/:id",
  verifyToken,
  verifyLibrarian,
  async (req, res) => {
    const database = await connectDB();
    const result = await database
      .collection("orders")
      .updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } }
      );
    res.send(result);
  }
);

app.get("/wishlist", verifyToken, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("wishlist")
    .find({ email: req.query.email })
    .toArray();
  res.send(result);
});

app.post("/wishlist", verifyToken, async (req, res) => {
  const database = await connectDB();
  const result = await database.collection("wishlist").insertOne(req.body);
  res.send(result);
});

app.delete("/wishlist/:id", verifyToken, async (req, res) => {
  const database = await connectDB();
  const result = await database
    .collection("wishlist")
    .deleteOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
});

app.get("/reviews/:bookId", async (req, res) => {
  try {
    const database = await connectDB();
    const bookId = req.params.bookId;

    const result = await database
      .collection("reviews")
      .find({ bookId: bookId })
      .sort({ date: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching reviews" });
  }
});

app.post("/reviews", verifyToken, async (req, res) => {
  try {
    const database = await connectDB();
    const review = req.body;

    review.date = new Date();

    const result = await database.collection("reviews").insertOne(review);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error saving review" });
  }
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
  if (req.query.email !== req.decoded.email)
    return res.status(403).send({ message: "forbidden access" });
  const database = await connectDB();
  const result = await database
    .collection("payments")
    .find({ email: req.query.email })
    .toArray();
  res.send(result);
});

app.post("/payments", verifyToken, async (req, res) => {
  const database = await connectDB();
  const payment = req.body;
  const paymentResult = await database
    .collection("payments")
    .insertOne(payment);

  const deleteResult = await database
    .collection("orders")
    .updateOne(
      { _id: new ObjectId(payment.orderId) },
      { $set: { paymentStatus: "paid", status: "pending" } }
    );

  const bookUpdate = await database
    .collection("books")
    .updateOne(
      { _id: new ObjectId(payment.bookId) },
      { $inc: { quantity: -1 } }
    );

  res.send({ paymentResult, deleteResult, bookUpdate });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`BookCourier is running on port ${port}`);
  });
}

module.exports = app;
