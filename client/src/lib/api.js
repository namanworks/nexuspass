/**
 * Universal API wrapper that handles the base URL and credentials (cookies)
 * for all requests to the backend server.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const fetchOptions = {
    ...options,
    headers,
    // VERY IMPORTANT: Ensures the httpOnly JWT cookie is sent with every request
    credentials: 'include', 
  };

  if (options.body && typeof options.body === 'object') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  
  // Try to parse the JSON, but fallback gracefully if response is not JSON
  let data;
  try {
    data = await response.json();
  } catch (err) {
    data = { error: true, message: 'Invalid JSON response from server' };
  }

  if (!response.ok) {
    // Standardize error throwing based on backend error format
    const errorMsg = data.message || `HTTP Error ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.code = data.code || 'UNKNOWN_ERROR';
    error.data = data;
    throw error;
  }

  return data.data; // Return the inner 'data' object per our backend response format
}
