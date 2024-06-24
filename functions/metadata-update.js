/**
 * Updates the existing metadata with the new metadata.
 * @param {string} existingMetadata - The existing metadata in Psych-DS format.
 * @param {string} newMetadata - The new metadata in Psych-DS format.
 * @returns {Promise} A promise that resolves when the update is complete.
 */
export default async function updateMetadata(existingMetadata, newMetadata) {

  /**
   * Parses the metadata and returns the 'variableMeasured' list.
   * @param {string} metadata - The metadata to parse.
   * @returns {Object[]} The 'variableMeasured' array of variable objects.
   * @throws {Error} If the metadata cannot be parsed.
   */
  const parseMetadata = (metadata) => {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Invalid metadata format');
    }
    return metadata['variableMeasured'];
  };

  /**
   * Provides a list of variables which are either included or excluded from excludeList.
   * @param {Array} variables - The variables to filter.
   * @param {Array} excludeList - The list of variable names to exclude or include.
   * @param {boolean} exclude - Whether to exclude or include the variables in the excludeList.
   * @returns {Array} The filtered variables.
   */
  const filterVariables = (variables, excludeList, exclude) => 
    variables.filter(variable => exclude === excludeList.includes(variable.name));

  /**
   * Finds the index of a variable in a list of variables.
   * @param {string} variableName - The name of the variable to find.
   * @param {Array} variableList - The list of variables to search.
   * @returns {number} The index of the variable in the list, or -1 if the variable is not found.
   */
  const findVariableIndex = (variableName, variableList) => 
    variableList.findIndex(variable => variable['name'] === variableName);

  /**
   * Updates the levels of an existing variable with the levels of a new variable,
   * by adding if it doesn't exist, or pushing to if it is incomplete.
   * @param {Object} existingVariable - The existing variable.
   * @param {Object} newVariable - The new variable.
   */
  const updateLevels = (existingVariable, newVariable) => {
    // If newVariable doesn't have levels, there's nothing to update
    if (!newVariable.levels) return;

    // If existingVariable doesn't have levels, just assign newVariable's levels to it
    if (!existingVariable.levels) {
        existingVariable.levels = newVariable.levels;
        return;
    }
    // If existingVariable does have levels, add newVariable's levels that aren't already present
    newVariable.levels.forEach(newLevel => {
        if (!existingVariable.levels.includes(newLevel)) {
            existingVariable.levels.push(newLevel);
        }
    });
};

  /**
   * Updates the minValue of an existing variable with the minValue of a new variable,
   * by creating it if it doesn't exist, or updating it if it is lower.
   * @param {Object} existingVariable - The existing variable.
   * @param {Object} newVariable - The new variable.
   */
  const updateMinValue = (existingVariable, newVariable) => {
    if (newVariable.minValue !== undefined) {
      if (existingVariable.minValue === undefined || newVariable.minValue < existingVariable.minValue) {
        existingVariable.minValue = newVariable.minValue;
      }
    }
  };

  /**
   * Updates the maxValue of an existing variable with the minValue of a new variable,
   * by creating it if it doesn't exist, or updating it if it is higher.
   * @param {Object} existingVariable - The existing variable.
   * @param {Object} newVariable - The new variable.
   */
  const updateMaxValue = (existingVariable, newVariable) => {
    if (newVariable.maxValue !== undefined) {
      if (existingVariable.maxValue === undefined || newVariable.maxValue > existingVariable.maxValue) {
        existingVariable.maxValue = newVariable.maxValue;
      }
    }
  };

  // Gets variableMeasured list in OSF database and for the latest data.
  const existingVariables = parseMetadata(existingMetadata);
  const newVariables = parseMetadata(newMetadata);


  // Splits variableMeasured list into two: one without default variables and one with.
  const excludeList = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
  const variablesToUpdate = filterVariables(existingVariables, excludeList, false);
  const variablesNotToUpdate = filterVariables(existingVariables, excludeList, true);
  
  const newVariablesNonDefault = filterVariables(newVariables, excludeList, false);


  for (const existingVariable of variablesToUpdate) {

    
    const newVariableIndex = findVariableIndex(existingVariable.name, newVariablesNonDefault);

    if (newVariableIndex === -1) continue; // Handle case when newVariable doesn't exist - for now it doesn't do anything.

    // Accesses the variable object in the latest data, that corresponds to the existingVariable being updated.
    const newVariable = newVariablesNonDefault[newVariableIndex];

    // Updates all fields, may add more later.
    updateLevels(existingVariable, newVariable);
    updateMinValue(existingVariable, newVariable);
    updateMaxValue(existingVariable, newVariable);
  }

  // Adds any new variables that don't exist to existing variables.
 newVariablesNonDefault.forEach(((newVariable) => {
    if (findVariableIndex(newVariable.name, variablesToUpdate) === -1) variablesToUpdate.push(newVariable);
  }))

 // Combines the updated non-default variables with the untouched default variables.
  const updatedVariables = [...variablesNotToUpdate, ...variablesToUpdate];

  // Updates the variableMeasured property of the existingMetadata with the updated list.
  const returnMetadata = { ...existingMetadata, variableMeasured: updatedVariables };

  return returnMetadata;
}