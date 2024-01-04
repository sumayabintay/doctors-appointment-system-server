const express = require('express');
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const app = express();

//Middleware
app.use(cors());
app.use(express.json())


//Mongo db connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tfjhyno.mongodb.net/?retryWrites=true&w=majority`;
// console.log(uri)
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function verifyJWT (req, res, next) {
  const authHeader = req.headers.authorization;
  if(!authHeader) {
    return res.status(401).send('Unauthorized Access')
  }

  const token = authHeader.split(' ') [1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
    if(err){
      return res.status(403).send({message: 'Forbidden Access'})
    }
    req.decoded = decoded;
    next();
  })
}

async function run() {
  try {
    //Use Aggregate to query multiple collection and then merge data
    const appointmentOptionCollection = client.db('doctorPortal').collection('appointmentOptions')
    const bookingsCollection = client.db('doctorPortal').collection('bookings')
    const usersCollection = client.db('doctorPortal').collection('users')
    const doctorsCollection = client.db('doctorPortal').collection('doctors')

    // make sure you use verifyadmin after verifyJWT
    const verifyAdmin = async(req, res, next) => {
      console.log('inside verifyAdmin', req.decoded.email)
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail};
      const user = await usersCollection.findOne(query)

      if(user?.role !== 'admin'){
        return res.status(403).send({message: "Forbidden Access"})
      }
      next();
    }

    app.get('/appointmentOptions', async(req, res) => {
      const date = req.query.date;
      const query = {}
      const options = await appointmentOptionCollection.find(query).toArray();
      // const options =await doctorsCollection.find().toArray()
      // Booking Date Selected
      const bookingQuery = {appointmentDate: date}
      const alreadyBooking = await bookingsCollection.find(bookingQuery).toArray()

      options?.forEach(option => {
        const optionBooked = alreadyBooking?.filter(book => book.treatment === option.name)
        const bookedSlots = optionBooked?.map(book => book.slot)
        const remainingSlots = option?.slots?.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots
      })
    
      res.send(options)
    })

    // ---------------------------------------------------

    // Bookings Api Create
    // const usersC = client.db('doctorPortal').collection('users')
    app.get('/bookings', verifyJWT, async(req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email
      if(email !== decodedEmail){
        return res.status(403).send({message: 'Forbidden Access'})
      }
      const query = {email: email};
      const {role} = await usersCollection.findOne({email})
      console.log(role);
      const booking = role === 'admin' ? await bookingsCollection.find().toArray(): await bookingsCollection.find(query).toArray()
      res.send(booking)
    })


    
    app.post('/bookings', async(req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }

      // don't work perfectly
      app.get('/bookings/:id', async(req, res) => {
        const id = req.params.id
        console.log('error')
        const query = {_id: new ObjectId(id)}
        const booking = await bookingsCollection.findOne(query)
        res.send(booking)
      })
      

      //Delete Api for Booking
      // app.delete('/bookings/:id', async (req, res) => {
      //   const id = req.params.id;
      //   const filter = {_id: new ObjectId(id)};
      //   const result = await bookingsCollection.deleteOne(filter)
      //   res.send(result)
      // })

      const alreadyBooked = await bookingsCollection.find(query).toArray()
      if(alreadyBooked.length){
        const message = `You Already Have a booking on ${booking.appointmentDate}`
        return res.send({acknowledged: false, message})
      }
      const result =await bookingsCollection.insertOne(booking)
      res.send(result)
    });

    // JWT TOKEN
    app.get('/jwt', async(req, res) => {
      const email = req.query.email;
      const query = {email: email};
      const user = await usersCollection.findOne(query);
      if(user) {
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1h'})
        return res.send({accessToken: token})
      }
      res.status(403).send({accessToken: " "})
    })


    // ----------------------------------------------------
    // Users Collection
    
    app.get('/users', async(req, res) => {
      const query = {}
      const users = await usersCollection.find(query).toArray()
      res.send(users)
    })

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email
      const query = {email}
      const user = await usersCollection.findOne(query)
      res.send({isAdmin: user?.role === 'admin'})
    })

    app.post('/users', async(req, res) => {
      const user = req.body
      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    //Make Admin
    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res) => {
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)}
      const options = {upsert: true}
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options)
      res.send(result)
    })

    // Make Doctor
    app.put('/users/doctor/:id', verifyJWT, async(req, res) => {
      // const decodedEmail = req.decoded.email;
      // const query = {email: decodedEmail}
      // const user = await usersCollection.findOne(query);

      // if(user?.role !== 'doctor'){
      //   return res.status(403).send({message: 'forbidden Access'})
      // }


      const id = req.params.id;
      const filter = {_id: new ObjectId(id)}
      const options = {upsert: true}
      const updatedDoc = {
        $set: {
          role: 'doctor'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options)
      res.send(result)
    })

    app.get('/users/doctor/:email', async (req, res) => {
      const email = req.params.email
      const query = {email}
      const user = await usersCollection.findOne(query)
      res.send({isDoctro: user?.role === 'doctor'})
    })

    // Make a doctor specialty Api
    app.get('/appointmentSpecialty', async (req, res) => {
      const query = {}
      const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray()
      res.send(result)
    })

    // Manage Al doctor Collectin Api
 
    app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
      const doctor = req.body;
      console.log(doctor);
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result)
    })
    // Get Doctors Api
    app.get('/doctors', async(req, res) => {
      const query = {}
      const doctors = await doctorsCollection.find(query).toArray()
      res.send(doctors)
    })

    //Delete Doctors Api
    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)};
      const result = await doctorsCollection.deleteOne(filter)
      res.send(result)
    })

    // Manage Al durgs Collectin Api
    const durgsCollection = client.db('doctorPortal').collection('drugs')
    app.post('/drugs', verifyJWT, verifyAdmin, async(req, res) => {
      const drug = req.body;
      const result = await durgsCollection.insertOne(drug)
      res.send(result)
    })

    // Get drugs Api
    app.get('/drugs', async(req, res) => {
      const query = {}
      const drugs = await durgsCollection.find(query).toArray()
      res.send(drugs)
    })

    //Delete drugs Api
    app.delete('/drugs/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)};
      const result = await durgsCollection.deleteOne(filter)
      res.send(result)
    })

    // Update price field on appointment options
    // app.get('/addPrice', async(req, res) => {
    //   const filter = {}
    //   const options = { upsert: true }
    //   const updatedDoc = {
    //     $set: {
    //       price: 90,
    //     }
    //   }
    //   const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options)
    //   res.send(result)
    // })
    
//************************************************** */
    // Payment Gateway api
    // app.post("/create-payment-intent", async(req, res) => {
    //   const booking = req.body;
    //   const price = booking.price;
    //   const amount = price * 100;

    //   const paymentIntent = await stripe.paymentIntents.create({
    //     currency: 'usd',
    //     amount: amount,
    //     "payment_method_types":[
    //       "card"
    //     ]
    //   });
    //   res.send({
    //     clientSecret: paymentIntent.client_secret,
    //   })
    // })

  }

  finally{

  }
}

run().catch(console.log);


app.get('/', async(req, res) => {
    res.send('Doctors Portal Server Running')
  })

  app.listen(port, () => {
    console.log(`Doctors Portal Running Port: ${port}`)
  })

