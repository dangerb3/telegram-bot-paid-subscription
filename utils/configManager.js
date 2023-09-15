// configManager.js
import dotenv from "dotenv";
import fs from "fs";

class ConfigManager {
  constructor() {
    this.config = {};
    this.loadConfig();
  }

  loadConfig() {
    const envFile = ".env";
    if (fs.existsSync(envFile)) {
      const parsedConfig = dotenv.parse(fs.readFileSync(envFile));
      this.config = { ...parsedConfig };
    }
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
  }

  addConfig(key, value) {
    this.config[key] = value;
    this.saveConfig();
  }

  saveConfig() {
    const envFile = ".env";
    const configString = Object.keys(this.config)
      .map((key) => `${key}=${this.config[key]}`)
      .join("\n");
    fs.writeFileSync(envFile, configString);
  }

  getConfig() {
    return this.config;
  }
}

const configManager = new ConfigManager();
export default configManager;
