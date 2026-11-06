const BACKEND_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000/api/v1";

const FORWARDED_HEADERS = ["authorization", "idempotency-key"] as const;

/**
 * Chuyển tiếp nguyên trạng yêu cầu booking tới backend NestJS.
 * Giữ nguyên status code và body của backend; KHÔNG bao giờ tự tạo phản hồi thành công.
 * Backend không phản hồi -> 503 (UC04-E4: không fallback để tránh giữ chỗ giả).
 */
export async function proxyBooking(
  request: Request,
  path: "hold" | "release",
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const rawBody = await request.text();

  try {
    const backendRes = await fetch(`${BACKEND_URL}/booking/${path}`, {
      method: "POST",
      headers,
      body: rawBody || "{}",
      signal: AbortSignal.timeout(8000),
    });
    const text = await backendRes.text();
    return new Response(text, {
      status: backendRes.status,
      headers: {
        "Content-Type":
          backendRes.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Hệ thống đang bận, vui lòng thử lại sau.",
        },
      },
      { status: 503 },
    );
  }
}
