import functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = initializeApp();
const api = express();

const db = getFirestore(app);

api.post('/', async (req, res) => {
  const { experimentID } = req.body;

  if(!experimentID) {
    res.status(400).send('Missing experimentID');
    return;
  }
  
  const exp_doc = await db.doc(`experiments/${experimentID}`).get();
  
  if(!exp_doc.exists){
    res.status(400).send('Experiment does not exist');
    return;
  }

  const exp_data = exp_doc.data();
  if(!exp_data.active){
    res.status(400).send('Experiment is not active');
    return;
  } 

  const user_doc = await db.doc(`users/${exp_data.owner}`).get();
  if(!user_doc.exists){
    res.status(400).send('This experiment has an invalid owner ID');
    return;
  } 

  const user_data = user_doc.data();
  if(!user_data.osfToken){
    res.status(400).send('This experiment does not have a valid OSF token');
    return;
  }

  const queryParams = new URLSearchParams({
    'type': 'files',
    'name': 'data2.csv',
  });

  const osfResult = await fetch(`${exp_data.osfFilesLink}?${queryParams.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user_data.osfToken}`,
    },
    body: JSON.stringify({
      test: 1,
      test2: 2
    })
  });
  if(osfResult.status !== 201){
    res.status(400).send('OSF returned an error');
    return;
  }

  res.status(201).send(`Success`);
  
});


const api_export = functions.https.onRequest(api);

export { api_export as api };


