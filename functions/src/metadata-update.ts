import { Metadata, Variable } from './interfaces';

/**
 * Updates the existing metadata with the new metadata.
 * @param {object} existingMetadata - The existing metadata in Psych-DS format.
 * @param {object} newMetadata - The new metadata in Psych-DS format.
 * @returns {Promise} A promise that resolves when the update is complete.
 */
export default async function updateMetadata(existingMetadata: Metadata, newMetadata: Metadata) {

  /**
   * Parses the metadata and returns the 'variableMeasured' list.
   * @param {Metadata} metadata - The metadata to parse.
   * @returns {Variable[]} The 'variableMeasured' array of variable objects.
   * @throws {Error} If the metadata cannot be parsed.
   */
  const parseMetadata = (metadata: Metadata): Variable[] => {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Invalid metadata format');
    }
    return metadata['variableMeasured'];
  };

  /**
   * Provides a list of variables which are either included or excluded from excludeList.
   * @param {Variable[]} variables - The variables to filter.
   * @param {string[]} excludeList - The list of variable names to exclude or include.
   * @param {boolean} exclude - Whether to exclude or include the variables in the excludeList.
   * @returns {Variable[]} The filtered variables.
   */
  const filterVariables = (variables: Variable[], excludeList: string[], exclude: boolean): Variable[] => 
    variables.filter(variable => exclude === excludeList.includes(variable.name));

  /**
   * Finds the index of a variable in a list of variables.
   * @param {string} variableName - The name of the variable to find.
   * @param {Variable[]} variableList - The list of variables to search.
   * @returns {number} The index of the variable in the list, or -1 if the variable is not found.
   */
  const findVariableIndex = (variableName: string, variableList: Variable[]): number => 
    variableList.findIndex(variable => variable.name === variableName);

  /**
   * Updates the levels of an existing variable with the levels of a new variable,
   * by adding if it doesn't exist, or pushing to if it is incomplete.
   * @param {Variable} existingVariable - The existing variable.
   * @param {Variable} newVariable - The new variable.
   */
  const updateLevels = (existingVariable: Variable, newVariable: Variable) => {
    // If newVariable doesn't have levels, there's nothing to update
    if (!newVariable.levels) return;

    // If existingVariable doesn't have levels, just assign newVariable's levels to it
    if (!existingVariable.levels) {
        existingVariable.levels = newVariable.levels;
        return;
    }
    // If existingVariable does have levels, add newVariable's levels that aren't already present
    newVariable.levels.forEach(newLevel => {
        if (!existingVariable.levels?.includes(newLevel)) {
            existingVariable.levels?.push(newLevel);
        }
    });
};

  /**
   * Updates the minValue of an existing variable with the minValue of a new variable,
   * by creating it if it doesn't exist, or updating it if it is lower.
   * @param {Variable} existingVariable - The existing variable.
   * @param {Variable} newVariable - The new variable.
   */
  const updateMinValue = (existingVariable: Variable, newVariable: Variable) => {
    if (newVariable.minValue !== undefined) {
      if (existingVariable.minValue === undefined || newVariable.minValue < existingVariable.minValue) {
        existingVariable.minValue = newVariable.minValue;
      }
    }
  };

  /**
   * Updates the maxValue of an existing variable with the minValue of a new variable,
   * by creating it if it doesn't exist, or updating it if it is higher.
   * @param {Variable} existingVariable - The existing variable.
   * @param {Variable} newVariable - The new variable.
   */
  const updateMaxValue = (existingVariable: Variable, newVariable: Variable) => {
    if (newVariable.maxValue !== undefined) {
      if (existingVariable.maxValue === undefined || newVariable.maxValue > existingVariable.maxValue) {
        existingVariable.maxValue = newVariable.maxValue;
      }
    }
  };

  // Gets variableMeasured list in OSF database and for the latest data.
  const existingVariables: Variable[] = parseMetadata(existingMetadata);
  const newVariables: Variable[] = parseMetadata(newMetadata);


  // Splits variableMeasured list into two: one without default variables and one with.
  const excludeList: string[] = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
  const variablesToUpdate: Variable[] = filterVariables(existingVariables, excludeList, false);
  const variablesNotToUpdate: Variable[] = filterVariables(existingVariables, excludeList, true);
  
  const newVariablesNonDefault: Variable[] = filterVariables(newVariables, excludeList, false);


  for (const existingVariable of variablesToUpdate) {

    const newVariableIndex: number = findVariableIndex(existingVariable.name, newVariablesNonDefault);

    if (newVariableIndex === -1) continue; // Handle case when newVariable doesn't exist - for now it doesn't do anything.

    // Accesses the variable object in the latest data, that corresponds to the existingVariable being updated.
    const newVariable: Variable = newVariablesNonDefault[newVariableIndex];

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
  const updatedVariables: Variable[] = [...variablesNotToUpdate, ...variablesToUpdate];

  // Updates the variableMeasured property of the existingMetadata with the updated list.
  const returnMetadata: object = { ...existingMetadata, variableMeasured: updatedVariables };

  return returnMetadata;
}