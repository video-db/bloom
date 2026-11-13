// SDK errors can contain headers and signed URLs; only these safe errors cross the boundary.
class ServiceError extends Error {
  constructor(code, message, { uncertain = false } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.uncertain = uncertain;
  }
}

function safeError(error) {
  if (error instanceof ServiceError) return error;
  const status = Number(error?.status ?? error?.response?.status);
  if (status === 401 || error?.constructor?.name === 'AuthenticationError')
    return new ServiceError(
      'authentication',
      'Reconnect your VideoDB account and try again.',
    );
  if (status === 403)
    return new ServiceError(
      'forbidden',
      'This account cannot access that recording.',
    );
  if (status === 404)
    return new ServiceError(
      'not-found',
      'This recording is no longer available.',
    );
  if (error?.name === 'RequestTimeoutError')
    return new ServiceError(
      'timeout',
      'VideoDB took too long to respond. Check the result before trying again.',
    );
  return new ServiceError(
    'unavailable',
    'VideoDB could not complete the request. Check your connection and try again.',
  );
}

// A deadline bounds the host wait, not the underlying SDK request or its remote effect.
function request(work, { timeoutMs = 30000, mutation = false } = {}) {
  let timer;
  return Promise.race([
    Promise.resolve()
      .then(work)
      .catch((error) => {
        const safe = safeError(error);
        if (mutation && ['unavailable', 'timeout'].includes(safe.code))
          safe.uncertain = true;
        throw safe;
      }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ServiceError(
              'timeout',
              mutation
                ? 'The response was delayed. Check the result before trying again.'
                : 'The request took too long. Try again when connected.',
              { uncertain: mutation },
            ),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { ServiceError, safeError, request };
