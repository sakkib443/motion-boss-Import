const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

// middleawre
app.use(cors())
app.use(express.json());



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b5kfivm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        // jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // Get Course Data From Servver
        const courseCollection = client.db("motion-boss").collection("course");
        app.get('/course', async (req, res) => {
            const result = await courseCollection.find().toArray();
            res.send(result);
        })
        // Get reviews Data From Servver
        const reviewsCollection = client.db("motion-boss").collection("reviews");
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })

        // middlewere----------------------
        const verifyToken = (req, res, next) => {
            console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' })
                }
                req.decoded = decoded;
                next();
            })
        };

        // use verify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }


        // Post user Data to Servver
        const userCollection = client.db("motion-boss").collection("users");
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result)
        });

        // Get user Data From Servver
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already in Database', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        const cartCollection = client.db("motion-boss").collection("carts")

        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result)
        })
        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });
        // delete carts data
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query)
            res.send(result);
        })

        // Baksh payment 
        const bkashCollection = client.db("motion-boss").collection("paymentInfo")
        app.post('/paymentInfo', async (req, res) => {
            const bkashPayment = req.body;
            const bkashPaymentResult = await bkashCollection.insertOne(bkashPayment)
            res.send(bkashPaymentResult)
        })



        app.get('/paymentInfo', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await bkashCollection.find(query).toArray();
            res.send(result)
        })

        app.get('/adminPaymentInfo', async (req, res) => {
            const result = await bkashCollection.find().toArray();
            res.send(result)
        })




// Delete payment ino
app.delete('/adminPaymentInfo/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await bkashCollection.deleteOne(query);
        if (result.deletedCount > 0) {
            res.status(200).json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Payment information not found" });
        }
    } catch (error) {
        console.error("Error deleting payment information:", error);
        res.status(500).json({ success: false, message: "An error occurred while deleting payment information" });
    }
});



// Payment intent
app.post('/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    const amount = parseInt(price * 100);
    console.log(amount, 'amount inside the intent')

    const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
    });
    res.send({
        clientSecret: paymentIntent.client_secret
    })
})
const paymentCollection = client.db("motion-boss").collection("payments")
app.post('/payments', async (req, res) => {
    const payment = req.body;
    const paymentResult = await paymentCollection.insertOne(payment)

    console.log('payment info', payment);
    const query = {
        _id: {
            $in: payment.cartIds.map(id => new ObjectId(id))
        }
    }
    const deleteResult = await cartCollection.deleteMany(query)
    res.send({ paymentResult, deleteResult })

})
app.get('/payments/:email', verifyToken, async (req, res) => {
    const query = { email: req.params.email }
    if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
    }
    const result = await paymentCollection.find(query).toArray();
    res.send(result)
})






// stats or analytics
app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
    const users = await userCollection.estimatedDocumentCount();
    const courses = await courseCollection.estimatedDocumentCount();
    const orders = await paymentCollection.estimatedDocumentCount();

    const payments = await paymentCollection.find().toArray();
    const revenue = payments.reduce((total, payment) => total + payment.price, 0)
    //     const result = await paymentCollection.aggregate([{
    //         $group:{
    //             _id: null,
    //             totalRevenue :{
    //                 $sum:'$price'
    //             }
    //         }
    //     }]).toArray()
    //   const revenue = result.length>0 ? result[0] : 0;
    res.send({
        users,
        courses,
        orders,
        revenue
    })

})


app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) }
    const updatedDoc = {
        $set: {
            role: 'admin'
        }
    }
    const result = await userCollection.updateOne(filter, updatedDoc)
    res.send(result)
})


// Admin access

app.get('/users/admin/:email', verifyToken, async (req, res) => {
    const email = req.params.email;

    if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
    }
    const query = { email: email };
    const user = await userCollection.findOne(query);
    let admin = false;
    if (user) {
        admin = user?.role === 'admin';
    }
    res.send({ admin });
})

//   cart collection







// detele user data
app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id
    const query = { _id: new ObjectId(id) }
    const result = await userCollection.deleteOne(query)
    res.send(result)
})


        // Send a ping to confirm a successful connection
        //     await client.db("admin").command({ ping: 1 });
        //     console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
}
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('boss is running')
})

app.listen(port, () => {
    console.log(`Motion Boss is running in port ${port}`)
})
