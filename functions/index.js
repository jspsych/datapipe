import functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";

const app = initializeApp();
const db = getFirestore(app);

const api = express();

api.use(cors({ origin: true }));

api.post('/', async (req, res) => {

  const { experimentID, data, filename } = req.body;

  if(!experimentID) {
    res.status(400).send('Missing parameter experimentID');
    return;
  }
  if(!data) {
    res.status(400).send('Missing parameter data');
    return;
  }
  if(!filename) {
    res.status(400).send('Missing parameter filename');
    return;
  }
  
  const exp_doc_ref = db.collection('experiments').doc(experimentID);
  const exp_doc = await exp_doc_ref.get();
  
  if(!exp_doc.exists){
    res.status(400).send('Experiment does not exist');
    return;
  }

  const exp_data = exp_doc.data();
  if(!exp_data.active){
    res.status(400).send('Experiment is not active');
    return;
  } 

  if(exp_data.useValidation){
    let valid = false;
    if(exp_data.allowJSON){
      const validJSON = validateJSON(data);
      if(validJSON){
        valid = true;
      }
    }
    if(exp_data.allowCSV && !valid){
      const validCSV = validateCSV(data);
      if(validCSV){
        valid = true;
      }
    }
    if(!valid){
      res.status(400).send('Data is not valid');
      return;
    }
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
    'name': filename,
  });

  const osfResult = await fetch(`${exp_data.osfFilesLink}?${queryParams.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user_data.osfToken}`,
    },
    body: data,
  });
  if(osfResult.status !== 201){
    res.status(400).send('OSF returned an error');
    return;
  }

  await exp_doc_ref.set({sessions: FieldValue.increment(1)}, {merge: true});

  res.status(201).send(`Success`);
  
});

api.post('/base64', async (req, res) => {
  const { experimentID, data, filename } = req.body;

  if(!experimentID) {
    res.status(400).send('Missing parameter experimentID');
    return;
  }
  if(!data) {
    res.status(400).send('Missing parameter data');
    return;
  }
  if(!filename) {
    res.status(400).send('Missing parameter filename');
    return;
  }
  
  const exp_doc_ref = db.collection('experiments').doc(experimentID);
  const exp_doc = await exp_doc_ref.get();
  
  if(!exp_doc.exists){
    res.status(400).send('Experiment does not exist');
    return;
  }

  const exp_data = exp_doc.data();
  if(!exp_data.active){
    res.status(400).send('Experiment is not active');
    return;
  } 

  const buffer = Buffer.from(data, 'base64');

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
    'name': filename,
  });

  const osfResult = await fetch(`${exp_data.osfFilesLink}?${queryParams.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user_data.osfToken}`,
    },
    body: buffer,
  });
  if(osfResult.status !== 201){
    res.status(400).send('OSF returned an error');
    return;
  }

  res.status(201).send(`Success`);
});

api.get('/condition', async (req, res) => {
  const { experimentID } = req.body;

  if(!experimentID) {
    res.status(400).send('Missing parameter experimentID');
    return;
  }

  const exp_doc_ref = db.collection('experiments').doc(experimentID);
  const exp_doc = await exp_doc_ref.get();
  
  if(!exp_doc.exists){
    res.status(400).send('Experiment does not exist');
    return;
  }

  const exp_data = exp_doc.data();
  if(!exp_data.active){
    res.status(400).send('Experiment is not active');
    return;
  } 

  // if there is only 1 condition, just send 0
  if(exp_data.nConditions === 1){
    res.status(200).send('0');
    return;
  }

  // use a transaction here because current SDK doesn't supply transformed result after a set operation.
  // this might change in the future because it seems to be supported in other versions of the SDK.
  let condition;
  try {
    condition = await db.runTransaction(async (t) => {
      const exp_doc = await t.get(exp_doc_ref);
      const exp_data = exp_doc.data();
      const currentCondition = exp_data.currentCondition;
      const nextCondition = (currentCondition + 1) % exp_data.nConditions;
      t.set(exp_doc_ref, {currentCondition: nextCondition}, {merge: true});
      return currentCondition;
    });
  } catch(error){
    res.status(400).send('Error getting condition');
    return;
  }
  
  res.status(200).send(condition.toString());
  return;
});

const api_export = functions.https.onRequest(api);

export { api_export as api };


