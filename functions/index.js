const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

const app = express();

app.post('/', (req, res) => {
  const { experimentID } = req.body;

  if(!experimentID) {
    res.status(400).send('Missing experimentID');
  }
  if(experimentID){

    admin.firestore().doc(`experiments/${experimentID}`)
    
    res.status(201).send(`Experiment ${experimentID} created!`);
  } 
  
});

exports.api = functions.https.onRequest(app);


