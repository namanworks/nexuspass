const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  let token = null;
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("nexusUser");
      if (stored) token = JSON.parse(stored).token;
    } catch (_) {}
  }

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const fetchOptions = {
    ...options,
    headers,
    credentials: "include",
  };

  if (options.body && typeof options.body === "object") {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  let data;
  try {
    data = await response.json();
  } catch (err) {
    data = { error: true, message: "Invalid JSON response from server" };
  }

  if (!response.ok) {
    const errorMsg = data.message || `HTTP Error ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.code = data.code || "UNKNOWN_ERROR";
    error.data = data;
    throw error;
  }

  return data.data;
}
