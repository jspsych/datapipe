import Joi from 'joi';

const jsPsychTrialSchema = Joi.object({
  trial_type: Joi.string().required()
});

const jsPsychSchema = Joi.array().items(jsPsychTrialSchema);

export default function validateJSON(json) {
  let parsedJSON = null;
  try {
    parsedJSON = JSON.parse(json);
  } catch(error) {
    console.log(error);
    return false;
  }
  
  const { error } = jsPsychSchema.validate(parsedJSON);
  if (error) {
    console.log(error);
    return false;
  }
  return true;
}