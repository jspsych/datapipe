class AuthorsMap {
  constructor() {
    this.authors = {};
  }
  getList() {
    const author_list = [];
    for (const key of Object.keys(this.authors)) {
      author_list.push(this.authors[key]);
    }
    return author_list;
  }
  setAuthor(fields) {
    if (Object.keys(fields).length == 1) {
      this.authors[fields.name] = fields.name;
      return;
    }
    const new_author = {};
    new_author["name"] = fields["name"];
    delete fields["name"];
    for (const key in fields) {
      if (fields[key] !== void 0 && fields[key] !== null) {
        new_author[key] = fields[key];
      }
    }
    this.authors[new_author.name] = new_author;
  }
  getAuthor(name) {
    if (name in this.authors) {
      return this.authors[name];
    } else
      return {};
  }
}

class VariablesMap {
  constructor() {
    this.generateDefaultVariables();
  }
  generateDefaultVariables() {
    this.variables = {};
    const trial_type_var = {
      type: "PropertyValue",
      name: "trial_type",
      description: {
        default: "unknown",
        jsPsych: "The name of the plugin used to run the trial."
      },
      value: "string"
    };
    this.setVariable(trial_type_var);
    const trial_index_var = {
      type: "PropertyValue",
      name: "trial_index",
      description: {
        default: "unknown",
        jsPsych: "The index of the current trial across the whole experiment."
      },
      value: "numeric"
    };
    this.setVariable(trial_index_var);
    const time_elapsed_var = {
      type: "PropertyValue",
      name: "time_elapsed",
      description: {
        default: "unknown",
        jsPsych: "The number of milliseconds between the start of the experiment and when the trial ended."
      },
      value: "numeric"
    };
    this.setVariable(time_elapsed_var);
  }
  getList() {
    var var_list = [];
    for (const key of Object.keys(this.variables)) {
      const variable = this.variables[key];
      const description = variable["description"];
      const numKeys = Object.keys(description).length;
      if (numKeys === 0)
        console.error("Empty description");
      else if (numKeys === 1) {
        const key2 = Object.keys(description)[0];
        variable["description"] = description[key2];
      } else if (numKeys == 2) {
        delete description["default"];
        if (Object.keys(description).length == 1) {
          const key2 = Object.keys(description)[0];
          variable["description"] = description[key2];
        }
      } else if (numKeys > 2) {
        delete description["default"];
      }
      var_list.push(variable);
    }
    return var_list;
  }
  setVariable(fields) {
    const new_variable = {};
    for (const key in fields) {
      if (fields[key] !== void 0 && fields[key] !== null) {
        new_variable[key] = fields[key];
      }
    }
    this.variables[new_variable.name] = new_variable;
  }
  getVariable(name) {
    return this.variables[name] || {};
  }
  containsVariable(name) {
    return name in this.variables;
  }
  getVariableNames() {
    var var_list = [];
    for (const key of Object.keys(this.variables)) {
      var_list.push(this.variables[key]["name"]);
    }
    return var_list;
  }
  updateVariable(var_name, field_name, added_value) {
    const updated_var = this.getVariable(var_name);
    if (Object.keys(updated_var).length === 0) {
      console.error(`Variable "${var_name}" does not exist.`);
      return;
    }
    if (field_name === "levels") {
      this.updateLevels(updated_var, added_value);
    } else if (field_name === "minValue" || field_name === "maxValue") {
      this.updateMinMax(updated_var, added_value, field_name);
    } else if (field_name === "description") {
      this.updateDescription(updated_var, added_value);
    } else if (field_name === "name") {
      this.updateName(updated_var, added_value);
    } else {
      updated_var[field_name] = added_value;
    }
  }
  updateLevels(updated_var, added_value) {
    if (!Array.isArray(updated_var["levels"])) {
      updated_var["levels"] = [];
    }
    if (!updated_var["levels"].includes(added_value)) {
      updated_var["levels"].push(added_value);
    }
  }
  updateMinMax(updated_var, added_value, field_name) {
    if (!("minValue" in updated_var) || !("maxValue" in updated_var)) {
      updated_var["maxValue"] = updated_var["minValue"] = added_value;
      return;
    }
    if (field_name === "minValue" && updated_var["minValue"] > added_value) {
      updated_var["minValue"] = added_value;
    } else if (field_name === "maxValue" && updated_var["maxValue"] < added_value) {
      updated_var["maxValue"] = added_value;
    }
  }
  updateDescription(updated_var, added_value) {
    const add_key = Object.keys(added_value)[0];
    const add_value = Object.values(added_value)[0];
    if (add_key === "undefined" || add_value === "undefined") {
      console.error("New value is passed in correct format");
      return;
    }
    var exists = false;
    if (typeof updated_var["description"] !== "object") {
      updated_var["description"] = {};
    }
    Object.entries(updated_var["description"]).forEach(([key, value]) => {
      if (value === add_value) {
        if (!key.includes(add_key)) {
          delete updated_var["description"][key];
          updated_var["description"][key + ", " + add_key] = add_value;
        }
        exists = true;
      }
    });
    if (!exists)
      Object.assign(updated_var["description"], added_value);
  }
  updateName(updated_var, added_value) {
    const old_name = updated_var["name"];
    updated_var["name"] = added_value;
    delete this.variables[old_name];
    this.setVariable(
      updated_var
    );
  }
  checkDescription(var_name, field_name, added_var) {
    if (field_name !== "description")
      return false;
    const variable = this.getVariable(var_name);
    if (Object.keys(variable).length === 0) {
      console.error("Variable has not been initalized");
      return false;
    }
    const field = variable[field_name];
    if (typeof field === "undefined") {
      console.error("Field has not been defined");
      return false;
    }
    if (field !== added_var || typeof field === "object") {
      return true;
    }
    return false;
  }
  deleteVariable(var_name) {
    if (var_name in this.variables) {
      delete this.variables[var_name];
    } else {
      console.error(`Variable "${var_name}" does not exist.`);
    }
  }
}

class JsPsychMetadata {
  constructor(JsPsych2) {
    this.JsPsych = JsPsych2;
    this.generateDefaultMetadata();
  }
  generateDefaultMetadata() {
    this.metadata = {};
    this.setMetadataField("name", "title");
    this.setMetadataField("schemaVersion", "Psych-DS 0.4.0");
    this.setMetadataField("@context", "https://schema.org");
    this.setMetadataField("@type", "Dataset");
    this.setMetadataField("description", "Dataset generated using JsPsych");
    this.authors = new AuthorsMap();
    this.variables = new VariablesMap();
    this.cache = {};
  }
  setMetadataField(key, value) {
    this.metadata[key] = value;
  }
  getMetadataField(key) {
    return this.metadata[key];
  }
  getMetadata() {
    const res = this.metadata;
    res["author"] = this.authors.getList();
    res["variableMeasured"] = this.variables.getList();
    return res;
  }
  setAuthor(fields) {
    this.authors.setAuthor(fields);
  }
  getAuthor(name) {
    return this.authors.getAuthor(name);
  }
  setVariable(fields) {
    this.variables.setVariable(fields);
  }
  getVariable(name) {
    return this.variables.getVariable(name);
  }
  containsVariable(name) {
    return this.variables.containsVariable(name);
  }
  updateVariable(var_name, field_name, added_value) {
    this.variables.updateVariable(var_name, field_name, added_value);
  }
  deleteVariable(var_name) {
    this.variables.deleteVariable(var_name);
  }
  getVariableNames() {
    return this.variables.getVariableNames();
  }
  displayMetadata(display_element) {
    const elementId = "jspsych-metadata-display";
    const metadata_string = JSON.stringify(this.getMetadata(), null, 2);
    display_element.innerHTML += `<p id="jspsych-metadata-header">Metadata</p><pre id="${elementId}" class="jspsych-preformat"></pre>`;
    document.getElementById(elementId).textContent += metadata_string;
  }
  saveAsJsonFile() {
    const jsonString = JSON.stringify(this.getMetadata(), null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dataset_description.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  async generate(data, metadata = {}) {
    if (typeof data === "string") {
      data = JSON.parse(data);
    }
    for (const observation of data) {
      await this.generateObservation(observation);
    }
    for (const key in metadata) {
      this.processMetadata(metadata, key);
    }
    console.log(this.cache);
    this.getMetadata();
  }
  async generateObservation(observation) {
    const pluginType = observation["trial_type"];
    const ignored_fields = /* @__PURE__ */ new Set(["trial_type", "trial_index", "time_elapsed"]);
    for (const variable in observation) {
      const value = observation[variable];
      if (ignored_fields.has(variable))
        this.updateFields(variable, value, typeof value);
      else if (this.containsVariable(variable)) {
        await this.generateUpdate(variable, value, pluginType);
      } else {
        await this.generateVariable(variable, value, pluginType);
      }
    }
  }
  async generateVariable(variable, value, pluginType) {
    const description = await this.getPluginInfo(pluginType, variable);
    const type = typeof value;
    const new_var = {
      type: "PropertyValue",
      name: variable,
      description: description ? { [pluginType]: description } : { [pluginType]: "unknown" },
      value: type
    };
    this.setVariable(new_var);
    this.updateFields(variable, value, type);
  }
  async generateUpdate(variable, value, pluginType) {
    const type = typeof value;
    const field_name = "description";
    const description = await this.getPluginInfo(pluginType, variable);
    const new_description = description ? { [pluginType]: description } : { [pluginType]: "unknown" };
    this.updateVariable(variable, field_name, new_description);
    this.updateFields(variable, value, type);
  }
  updateFields(variable, value, type) {
    if (type !== "number" && type !== "object") {
      this.updateVariable(variable, "levels", value);
    }
    if (type === "number") {
      this.updateVariable(variable, "minValue", value);
      this.updateVariable(variable, "maxValue", value);
    }
  }
  processMetadata(metadata, key) {
    const value = metadata[key];
    if (key === "variables") {
      if (typeof value !== "object" || value === null) {
        console.error("Variable object is either null or incorrect type");
        return;
      }
      for (let variable_key in value) {
        if (!this.containsVariable(variable_key)) {
          console.error("Metadata does not contain variable:", variable_key);
          continue;
        }
        const variable_parameters = value[variable_key];
        if (typeof variable_parameters !== "object" || variable_parameters === null) {
          console.error(
            "Parameters of variable:",
            variable_key,
            "is either null or incorrect type. The value",
            variable_parameters,
            "is either null or not an object."
          );
          continue;
        }
        for (const parameter in variable_parameters) {
          const parameter_value = variable_parameters[parameter];
          this.updateVariable(variable_key, parameter, parameter_value);
          if (parameter === "name")
            variable_key = parameter_value;
        }
      }
    } else if (key === "author") {
      if (typeof value !== "object" || value === null) {
        console.error("Author object is not correct type");
        return;
      }
      for (const author_key in value) {
        const author = value[author_key];
        if (!("name" in author))
          author["name"] = author_key;
        this.setAuthor(author);
      }
    } else
      this.setMetadataField(key, value);
  }
  async getPluginInfo(pluginType, variableName) {
    if (!this.cache[pluginType])
      this.cache[pluginType] = {};
    if (variableName in this.cache[pluginType]) {
      return this.cache[pluginType][variableName];
    }
    const unpkgUrl = `https://unpkg.com/@jspsych/plugin-${pluginType}/src/index.ts`;
    try {
      const response = await fetch(unpkgUrl);
      const scriptContent = await response.text();
      const description = getJsdocsDescription(scriptContent, variableName);
      if (!this.cache[pluginType])
        this.cache[pluginType] = {};
      this.cache[pluginType][variableName] = description;
      return description;
    } catch (error) {
      console.error(`Failed to fetch info from ${unpkgUrl}:`, error);
      if (!this.cache[pluginType])
        this.cache[pluginType] = {};
      this.cache[pluginType][variableName] = null;
      return null;
    }
  }
}
function getJsdocsDescription(scriptContent, variableName) {
  const paramRegex = scriptContent.match(/parameters:\s*{([\s\S]*?)};\s*/).join();
  const regex = new RegExp(`((.|
)*)(?=${variableName}:)`);
  const variableRegex = paramRegex.match(regex)[0];
  const descrip = variableRegex.slice(variableRegex.lastIndexOf("/**"));
  const clean = descrip.match(/(?<=\*\*)([\s\S]*?)(?=\*\/)/)[1];
  const cleaner = clean.replace(/(\r\n|\n|\r)/gm, "");
  const cleanest = cleaner.replace(/\*/gm, "");
  return cleanest.trim();
}

export { JsPsychMetadata as default };
//# sourceMappingURL=index.js.map
