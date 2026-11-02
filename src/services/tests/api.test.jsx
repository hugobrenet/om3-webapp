import {apiFetch, getResponseErrorMessage, problemOf} from "../api";
import {URL_CLUSTER_STATUS} from "../../config/apiPath";

global.fetch = jest.fn();

const createHeaders = (contentType) => ({
    get: (key) => key === 'content-type' ? contentType : null
});

const createHeadersWithoutGet = () => ({});

// A read of the cluster status, as the webapp made it: the requests of apiFetch,
// its headers, its errors and its timeout.
const readStatus = (token, options = {}) => apiFetch(URL_CLUSTER_STATUS, {
    method: 'GET',
    headers: {...options.headers, ...(token && {Authorization: `Bearer ${token}`})},
    ...options,
});

describe("apiFetch", () => {
    const token = "fake-token";

    beforeEach(() => {
        jest.clearAllMocks();

        global.AbortController = jest.fn(() => ({
            abort: jest.fn(),
            signal: {
                aborted: false,
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                dispatchEvent: jest.fn(),
            }
        }));

        global.clearTimeout = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("calls fetch with correct URL and headers", async () => {
        const mockData = {status: "ok"};

        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("application/json"),
            json: async () => mockData,
            text: async () => JSON.stringify(mockData),
        });

        const result = await readStatus(token);

        expect(fetch).toHaveBeenCalledWith(
            URL_CLUSTER_STATUS,
            expect.objectContaining({
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
        );

        const fetchCall = fetch.mock.calls[0];
        expect(fetchCall[1]).toHaveProperty('signal');
        expect(fetchCall[1].signal).toBeDefined();

        expect(result).toEqual(mockData);
    });

    test("throws ApiError with server message when response is not ok and has JSON body", async () => {
        const mockErrorBody = {error: "Server error", details: "Something went wrong"};

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            headers: createHeaders("application/json"),
            json: async () => mockErrorBody,
            text: async () => JSON.stringify(mockErrorBody),
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Server error",
            status: 500,
            statusText: "Internal Server Error",
            body: mockErrorBody
        });
    });

    test("throws ApiError with status text when response is not ok and has no body", async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: createHeaders("text/plain"),
            json: async () => {
                throw new Error("No JSON");
            },
            text: async () => "",
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Not Found",
            status: 404,
            statusText: "Not Found",
        });
    });

    test("throws ApiError with generic message when response is not ok and no status text", async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 403,
            statusText: "",
            headers: createHeaders("text/plain"),
            json: async () => {
                throw new Error("No JSON");
            },
            text: async () => "",
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Request failed with status 403",
            status: 403,
            statusText: "",
        });
    });

    test("handles network errors correctly", async () => {
        const networkError = new Error("Network failure");
        fetch.mockRejectedValueOnce(networkError);

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Network failure",
            status: null,
            body: null
        });
    });

    test("works without token when token is not provided", async () => {
        const mockData = {status: "ok"};

        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("application/json"),
            json: async () => mockData,
            text: async () => JSON.stringify(mockData),
        });

        const result = await readStatus(null);

        expect(fetch).toHaveBeenCalledWith(
            URL_CLUSTER_STATUS,
            expect.objectContaining({
                method: "GET",
                headers: {},
            })
        );

        const fetchCall = fetch.mock.calls[0];
        expect(fetchCall[1]).toHaveProperty('signal');
        expect(fetchCall[1].signal).toBeDefined();

        expect(result).toEqual(mockData);
    });

    test("handles non-JSON error response with text body", async () => {
        const errorText = "Simple error message";

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            headers: createHeaders("text/plain"),
            json: async () => {
                throw new Error("Not JSON");
            },
            text: async () => errorText,
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: errorText,
            status: 400,
            statusText: "Bad Request",
            body: errorText
        });
    });

    test("handles response without headers.get method", async () => {
        const mockData = {status: "ok"};

        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeadersWithoutGet(),
            json: async () => mockData,
            text: async () => JSON.stringify(mockData),
        });

        const result = await readStatus(token);
        expect(result).toEqual(mockData);
    });

    test("handles JSON content-type with invalid JSON response (outer catch)", async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("application/json"),
            json: async () => {
                throw new Error("Invalid JSON");
            },
            text: async () => "invalid json string",
        });

        await expect(readStatus(token)).resolves.toBeNull();
    });

    test("handles response without json method", async () => {
        const mockData = {status: "ok"};

        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("text/plain"),
            text: async () => JSON.stringify(mockData),
        });

        const result = await readStatus(token);
        expect(result).toBeDefined();
    });

    test("handles response without text method", async () => {
        const mockData = {status: "ok"};

        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("text/plain"),
            json: async () => mockData,
        });

        const result = await readStatus(token);
        expect(result).toEqual(mockData);
    });

    test("handles error response with JSON message in body", async () => {
        const mockErrorBody = {message: "Custom error message"};

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            headers: createHeaders("application/json"),
            json: async () => mockErrorBody,
            text: async () => JSON.stringify(mockErrorBody),
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Custom error message",
            status: 400,
            body: mockErrorBody
        });
    });

    test("handles error response with string body that has message property", async () => {
        const errorString = JSON.stringify({message: "String error message"});

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            headers: createHeaders("text/plain"),
            json: async () => {
                throw new Error("Not JSON");
            },
            text: async () => errorString,
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "String error message",
            status: 400,
            body: {message: "String error message"}
        });
    });

    test("handles error with null body after all parsing attempts", async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Server Error",
            headers: createHeaders("application/octet-stream"),
            json: async () => {
                throw new Error("No JSON");
            },
            text: async () => {
                throw new Error("No text");
            },
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Server Error",
            status: 500,
            body: null
        });
    });

    test("handles error with object body without message property", async () => {
        const mockErrorBody = {error: "Error without message field"};

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            headers: createHeaders("application/json"),
            json: async () => mockErrorBody,
            text: async () => JSON.stringify(mockErrorBody),
        });

        await expect(readStatus(token)).rejects.toMatchObject({
            name: 'ApiError',
            message: "Error without message field",
            status: 400,
            body: mockErrorBody
        });
    });

    test("throws ApiError on request timeout", async () => {
        jest.useFakeTimers();
        const listeners = [];
        global.AbortController = jest.fn(() => ({
            abort: () => {
                listeners.forEach(listener => listener());
            },
            signal: {
                aborted: false,
                addEventListener: (type, listener) => {
                    if (type === 'abort') listeners.push(listener);
                },
                removeEventListener: (type, listener) => {
                    if (type === 'abort') {
                        const index = listeners.indexOf(listener);
                        if (index > -1) listeners.splice(index, 1);
                    }
                },
                dispatchEvent: jest.fn(),
            }
        }));

        fetch.mockImplementationOnce((url, options) => {
            return new Promise((resolve, reject) => {
                const abortError = new Error('Operation aborted');
                abortError.name = 'AbortError';
                options.signal.addEventListener('abort', () => reject(abortError));
            });
        });

        const timeoutMs = 5000;
        const promise = readStatus(token, {timeout: timeoutMs});
        jest.advanceTimersByTime(timeoutMs);
        await expect(promise).rejects.toMatchObject({
            name: 'ApiError',
            message: `Request timed out after ${timeoutMs}ms`,
            body: null
        });
        jest.useRealTimers();
    });

    // Bodies as a real fetch gives them: read once only.
    const refusedWith = (body, {status = 500, statusText = "Internal Server Error", contentType = "text/plain"} = {}) => {
        fetch.mockResolvedValueOnce(new Response(body, {status, statusText, headers: {"content-type": contentType}}));
        return readStatus(token);
    };

    test("a plain text refusal keeps its text", async () => {
        await expect(refusedWith("no route to host")).rejects.toMatchObject({
            message: "no route to host",
            status: 500,
            body: "no route to host",
        });
    });

    test("a text refusal announced as JSON keeps its text", async () => {
        await expect(refusedWith("upstream gone", {contentType: "application/json"})).rejects.toMatchObject({
            message: "upstream gone",
            body: "upstream gone",
        });
    });

    test("an HTML page: its status said, the page kept in the body", async () => {
        const page = "<!DOCTYPE html>\n<html><body><h1>502</h1></body></html>";
        const err = await refusedWith(page, {status: 502, statusText: "Bad Gateway", contentType: "text/html"}).catch((e) => e);
        expect(err).toMatchObject({message: "Bad Gateway", status: 502, body: page});
        expect(problemOf(err)).toBe("Bad Gateway");
    });

    test.each([
        [{detail: "object not found: ns/svc/x", status: 404, title: "Not found"}, "object not found: ns/svc/x"],
        [{status: 401, title: "Unauthorized"}, "Unauthorized"],
        [{message: "Not Found"}, "Not Found"],
    ])("the words of a problem of the daemon, not its JSON: %j", async (body, words) => {
        const err = await refusedWith(JSON.stringify(body), {status: 404, statusText: "Not Found", contentType: "application/json"}).catch((e) => e);
        expect(err).toMatchObject({message: words, body});
        expect(problemOf(err)).toBe(words);
    });

    test("an empty refusal says its status", async () => {
        await expect(refusedWith("", {status: 503, statusText: "Service Unavailable"})).rejects.toMatchObject({
            message: "Service Unavailable",
            body: null,
        });
    });

    test("a text answered with success is returned", async () => {
        fetch.mockResolvedValueOnce(new Response("pong", {status: 200, headers: {"content-type": "text/plain"}}));
        await expect(readStatus(token)).resolves.toBe("pong");
    });

    test("handles response without json and text methods", async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("application/json"),
        });
        const result = await readStatus(token);
        expect(result).toBeNull();
    });

    test("handles response with json missing and text throwing error", async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            headers: createHeaders("text/plain"),
            text: async () => {
                throw new Error("Text read failed");
            },
        });

        const result = await readStatus(token);
        expect(result).toBeNull();
    });
});

describe("getResponseErrorMessage", () => {
    test("returns null when response is falsy", async () => {
        const result = await getResponseErrorMessage(null);
        expect(result).toBeNull();
    });

    test("returns null when response.text throws an error", async () => {
        const response = {
            text: async () => {
                throw new Error("Failed to read text");
            },
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBeNull();
    });

    test("returns error message from 'error' field in JSON", async () => {
        const response = {
            text: async () => JSON.stringify({error: "An error occurred"}),
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBe("An error occurred");
    });

    test("returns error message from 'detail' field in JSON", async () => {
        const response = {
            text: async () => JSON.stringify({detail: "Detailed error"}),
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBe("Detailed error");
    });

    test("returns error message from 'title' field in JSON", async () => {
        const response = {
            text: async () => JSON.stringify({title: "Error title"}),
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBe("Error title");
    });

    test("returns null when JSON is an empty object", async () => {
        const response = {
            text: async () => JSON.stringify({}),
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBeNull();
    });

    test("returns joined values when JSON has other fields", async () => {
        const response = {
            text: async () => JSON.stringify({foo: "bar", baz: "qux"}),
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBe("bar | qux");
    });

    test("the detail of a problem of the daemon, before its title", async () => {
        const response = {text: async () => JSON.stringify({detail: "object not found", status: 404, title: "Not found"})};
        expect(await getResponseErrorMessage(response)).toBe("object not found");
    });

    test("no page of HTML as a message", async () => {
        const response = {text: async () => "<html><body>Bad Gateway</body></html>"};
        expect(await getResponseErrorMessage(response)).toBeNull();
    });

    test("returns text when response is not JSON", async () => {
        const response = {
            text: async () => "Plain text error",
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBe("Plain text error");
    });

    test("returns null when text is empty", async () => {
        const response = {
            text: async () => "",
        };
        const result = await getResponseErrorMessage(response);
        expect(result).toBeNull();
    });

    test("handles response without text method", async () => {
        const response = {};
        const result = await getResponseErrorMessage(response);
        expect(result).toBeNull();
    });
});
