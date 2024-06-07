import fetch from "node-fetch";

export default async function metadataUpdate(
  existingMetadata,
  newMetadata,
) {

  const existingVariables = JSON.parse(existingMetadata)['variableMeasured'];
  const existVariablesToUpdate = existingVariables.filter((variable)=> !(['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'].includes(variable.name)))
  const existVariablesToNotUpdate = existingVariables.filter((variable)=> (['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'].includes(variable.name)))


  const newVariables = JSON.parse(newMetadata)['variableMeasured'];
  const newVariablesToUpdate = newVariables.filter((variable)=> !(['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'].includes(variable.name)))

  function findVariableIndex(variableName, variableList) {
    let index = 0;
    for (const variable of variableList){
    
      //HANDLE IMPORTANT EDGE CASE: NAME IS SAME BUT NOT EXACTLY THE SAME
      if (variable['name'] === variableName){
        return index
      }
      index++
    } 
  }

  for (const existingVariable of existVariablesToUpdate) {
    var newVariable = newVariablesToUpdate[findVariableIndex(existingVariable.name, newVariablesToUpdate)];
    //console.log('newVariable', newVariable);
    //console.log('existingVariable', existingVariable);
    if (newVariable['levels'] && existingVariable['levels']){
      console.log(newVariable['levels'], existingVariable['levels']);
      if (newVariable['levels'] === existingVariable['levels']){
        continue;
      }
      else{
        newVariable['levels'].map((level) => existingVariable['levels'].includes(level) ? null : existingVariable['levels'].push(level));
      }
    } else if (newVariable['levels'] && !existingVariable['levels']){
      existingVariable['levels'] = newVariable['levels'];
    }
    
    if (newVariable['minValue'] && existingVariable['minValue']){
      if (newVariable['minValue'] >= existingVariable['minValue']){
        continue;
      }
      else if (newVariable['minValue'] < existingVariable['minValue']) {
        existingVariable['minValue'] = newVariable['minValue'];
      }
    } else if (newVariable['minValue'] && !existingVariable['minValue']){
      existingVariable['minValue'] = newVariable['minValue'];
    }
    
    if (newVariable['maxValue'] && existingVariable['maxValue']){
      if (newVariable['maxValue'] <= existingVariable['maxValue']){
        continue;
      }
      else if (newVariable['maxValue'] > existingVariable['maxValue']){
        existingVariable['maxValue'] = newVariable['maxValue'];
      }
    } else if (newVariable['maxValue'] && !existingVariable['maxValue']){
      existingVariable['maxValue'] = newVariable['maxValue'];
    }
  }

  //console.log(existVariablesToUpdate);

  //what happens if the format doesnt match? rewrite? IMPORTANT

  existVariablesToNotUpdate.push(...existVariablesToUpdate);

  var returnMetadata = JSON.parse(existingMetadata);
  returnMetadata['variableMeasured'] = existVariablesToNotUpdate;
 return returnMetadata;
}
