
import { createOAppSecurityConfig } from "./configs/OAppSecurityConfig.js";
import { createPopularOAppsWindowConfig } from "./configs/PopularOAppsWindowConfig.js";
import { createTopOAppsConfig } from "./configs/TopOAppsConfig.js";
import { createWebOfSecurityConfig } from "./configs/WebOfSecurityConfig.js";

export function buildQueryRegistry(coordinator) {
  return {
    "top-oapps": createTopOAppsConfig(coordinator),
    "oapp-security-config": createOAppSecurityConfig(coordinator),
    "popular-oapps-window": createPopularOAppsWindowConfig(coordinator),
    "web-of-security": createWebOfSecurityConfig(coordinator),
  };
}
