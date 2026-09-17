export class ApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export async function api(path, options = {}, token) {
    let response;
    try {
        response = await fetch(`/api${path}`, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...options.headers,
            },
            signal: options.signal ?? AbortSignal.timeout(15000),
        });
    }
    catch {
        throw new ApiError("Unable to reach SecureVote. Check your connection and try again.", 0);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
        throw new ApiError(data?.message ?? "The service is unavailable. Please try again.", response.status);
    }
    return data;
}
