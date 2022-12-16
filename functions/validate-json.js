
export default function validateJSON(json, requiredFields) {
  

  let parsedJSON = null;
  try {
    parsedJSON = JSON.parse(json);
  } catch (error) {
    return false;
  }

  if(Array.isArray(parsedJSON)){
    return parsedJSON.some((trial) => {
      const keys = Object.keys(trial);
      return requiredFields.every((field) => keys.includes(field));
    });
  } else {
    const keys = Object.keys(parsedJSON);
    return requiredFields.every((field) => keys.includes(field));
  }

  const { error } = schema.validate(parsedJSON);
  if (error) {
    console.log(error);
    return false;
  }
  return true;
}

function createSchema(requiredFields) {

  const fieldMap = new Map(requiredFields.map((field) => [field, Joi.any().required()]));
  console.log(fieldMap);

  const trialSchema = Joi.object(fieldMap);

  const arraySchema = Joi.array().has(trialSchema);
  const objectSchema = trialSchema;

  const schema = Joi.alternatives().try(arraySchema, objectSchema);

  return schema;
}
