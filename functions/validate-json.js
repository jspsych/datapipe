import Joi from "joi";

export default function validateJSON(json, requiredFields) {
  const schema = createSchema(requiredFields);

  let parsedJSON = null;
  try {
    parsedJSON = JSON.parse(json);
  } catch (error) {
    return false;
  }

  const { error } = schema.validate(parsedJSON);
  if (error) {
    console.log(error);
    return false;
  }
  return true;
}

function createSchema(requiredFields) {
  const trialSchema = Joi.object(
    new Map(requiredFields.map((field) => [field, Joi.any().required()]))
  );
  const arraySchema = Joi.array().has(trialSchema);
  const objectSchema = Joi.object(trialSchema);

  const schema = Joi.alternatives().try(arraySchema, objectSchema);

  return schema;
}
