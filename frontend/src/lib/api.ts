import axios from "axios";

// VITE_API_URL can be set explicitly (e.g. a deployed backend URL).
// When empty/unset, local dev uses Vite's /api proxy with path rewrite.
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const runningInHttpsPage =
  typeof window !== "undefined" && window.location.protocol === "https:";
const isInsecureAbsoluteApi = configuredApiUrl?.startsWith("http://");

const apiBaseUrl =
  !configuredApiUrl || (runningInHttpsPage && isInsecureAbsoluteApi)
    ? "/api"
    : configuredApiUrl;

const api = axios.create({
  baseURL: apiBaseUrl,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
