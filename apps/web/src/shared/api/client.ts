// apps/web/src/lib/api/client.ts
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  if (typeof document !== "undefined") {
    const match = document.cookie.match(
      /(?:^|;\s*)(?:accessToken|access_token)=([^;]+)/,
    );
    if (match?.[1]) {
      inMemoryAccessToken = decodeURIComponent(match[1]);
      return inMemoryAccessToken;
    }
  }
  return null;
}

export interface ApiStandardResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Tự động gọi /auth/refresh bằng HTTP-Only Cookie khi Access Token hết hạn.
 * Dùng cơ chế khóa (mutex) refreshPromise để tránh gọi trùng nhiều lần cùng lúc.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include", // Gửi kèm HTTP-Only refresh token cookie
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        setAccessToken(null);
        return null;
      }

      const payload = await res.json().catch(() => null);
      const newToken =
        payload?.data?.accessToken ?? payload?.accessToken ?? null;

      if (newToken) {
        setAccessToken(newToken);
        return newToken;
      }
      return null;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit,
  _isRetry = false,
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };

  const token = getAccessToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Máy chủ API hiện chưa phản hồi. Vui lòng kiểm tra kết nối backend hoặc sử dụng chế độ xem trước giao diện.",
    );
  }

  // Tự động Refresh Token khi gặp 401 Unauthorized (trừ các endpoint login/refresh)
  const isAuthEndpoint =
    endpoint.includes("/auth/login") ||
    endpoint.includes("/auth/register") ||
    endpoint.includes("/auth/refresh");

  if (response.status === 401 && !_isRetry && !isAuthEndpoint) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${newToken}`,
      };
      return apiClient<T>(
        endpoint,
        { ...options, headers: retryHeaders },
        true,
      );
    }
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ApiStandardResponse<T> | null;

  if (!response.ok || (payload && payload.success === false)) {
    throw new ApiError(
      response.status,
      payload?.error?.code || "UNKNOWN_ERROR",
      payload?.error?.message ||
        (typeof payload?.message === "string" && payload.message) ||
        "Không thể xử lý yêu cầu từ máy chủ tickethub",
      payload?.error?.details,
    );
  }

  return payload && "data" in payload ? payload.data : (payload as T);
}
