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
      "https://lighthouselibrary.vercel.app/",
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
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyLibrarian = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
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
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let role = "user";
      if (user) {
        role = user?.role || "user";
      }
      res.send({ role });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
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

        const query = { _id: new ObjectId(id) };
        const result = await bookCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Book not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error fetching book:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/books", verifyToken, verifyLibrarian, async (req, res) => {
      const item = req.body;
      const result = await bookCollection.insertOne(item);
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
      const query = { _id: new ObjectId(id) };
      const result = await bookCollection.deleteOne(query);
      res.send(result);
    });

    app.patch(
      "/books/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: { status: status },
        };
        const result = await bookCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );
    app.get("/orders", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email)
        return res.status(403).send({ message: "forbidden" });
      const query = { userEmail: email };
      const result = await orderCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await orderCollection.findOne(query);
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
        const query = { librarianEmail: email };
        const result = await orderCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.post("/orders", verifyToken, async (req, res) => {
      const order = req.body;
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });

    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await orderCollection.deleteOne(query);
      res.send(result);
    });

    app.patch(
      "/orders/status/:id",
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: { status: status },
        };
        const result = await orderCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.get("/wishlist", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await wishlistCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/wishlist", verifyToken, async (req, res) => {
      const wishlist = req.body;
      const result = await wishlistCollection.insertOne(wishlist);
      res.send(result);
    });

    app.delete("/wishlist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await wishlistCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/reviews/:bookId", async (req, res) => {
      const bookId = req.params.bookId;
      const query = { bookId: bookId };
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/reviews", verifyToken, async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
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

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments", verifyToken, async (req, res) => {
      const query = { email: req.query.email };
      if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      const query = { _id: new ObjectId(payment.orderId) };
      const updatedDoc = {
        $set: {
          paymentStatus: "paid",
          status: "pending",
        },
      };
      const deleteResult = await orderCollection.updateOne(query, updatedDoc);

      const bookQuery = { _id: new ObjectId(payment.bookId) };
      const bookUpdate = { $inc: { quantity: -1 } };
      const bookResult = await bookCollection.updateOne(bookQuery, bookUpdate);

      res.send({ paymentResult, deleteResult, bookResult });
    });

    app.get("/", (req, res) => {
      res.send("BookCourier server is running");
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`BookCourier is running on port ${port}`);
});
