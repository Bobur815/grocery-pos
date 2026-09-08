import { Router, type Route } from './router';

const noop = () => null;
const route = (method: Route['method'], path: string): Route => ({ method, path, handler: noop });

function router(...routes: Route[]): Router {
  return new Router().add(routes);
}

describe('Router.match', () => {
  it('matches a literal path', () => {
    const result = router(route('GET', '/products')).match('GET', '/products');
    expect('route' in result && result.route.path).toBe('/products');
  });

  it('extracts path parameters', () => {
    const result = router(route('GET', '/products/:id')).match('GET', '/products/42');
    expect('route' in result && result.params).toEqual({ id: '42' });
  });

  it('extracts several parameters', () => {
    const result = router(route('PATCH', '/inventory-counts/:id/items/:itemId')).match(
      'PATCH',
      '/inventory-counts/abc/items/xyz',
    );
    expect('route' in result && result.params).toEqual({ id: 'abc', itemId: 'xyz' });
  });

  // A barcode or an MXIK code can carry characters that must travel percent-encoded.
  it('decodes a percent-encoded parameter', () => {
    const result = router(route('GET', '/products/barcode/:barcode')).match(
      'GET',
      '/products/barcode/4%2F5',
    );
    expect('route' in result && result.params.barcode).toBe('4/5');
  });

  it('passes through a malformed escape rather than failing', () => {
    const result = router(route('GET', '/products/barcode/:barcode')).match(
      'GET',
      '/products/barcode/100%',
    );
    expect('route' in result && result.params.barcode).toBe('100%');
  });

  // The whole reason route order matters: `/suppliers/transactions` must not be read as a
  // supplier whose id is "transactions".
  it('prefers a literal segment registered before the parameter', () => {
    const result = router(
      route('GET', '/suppliers/transactions'),
      route('GET', '/suppliers/:id'),
    ).match('GET', '/suppliers/transactions');
    expect('route' in result && result.route.path).toBe('/suppliers/transactions');
  });

  it('still matches the parameter route for other values', () => {
    const result = router(
      route('GET', '/suppliers/transactions'),
      route('GET', '/suppliers/:id'),
    ).match('GET', '/suppliers/abc123');
    expect('route' in result && result.route.path).toBe('/suppliers/:id');
  });

  it('does not match a path with a different segment count', () => {
    const result = router(route('GET', '/products/:id')).match('GET', '/products/42/analytics');
    expect('route' in result).toBe(false);
  });

  it('reports an unknown path as unmatched', () => {
    const result = router(route('GET', '/products')).match('GET', '/nope');
    expect(result).toEqual({ matchedPath: false });
  });

  // The SPA needs to tell "this server is too old" from "you called it wrong".
  it('reports a known path under the wrong method as matched', () => {
    const result = router(route('GET', '/products')).match('POST', '/products');
    expect(result).toEqual({ matchedPath: true });
  });

  it('ignores a trailing slash', () => {
    const result = router(route('GET', '/categories')).match('GET', '/categories/');
    expect('route' in result && result.route.path).toBe('/categories');
  });

  it('keeps method-specific handlers on the same path apart', () => {
    const get = router(route('GET', '/settings/:key'), route('PUT', '/settings/:key'));
    expect('route' in get.match('PUT', '/settings/printer_name') && true).toBe(true);
    const matched = get.match('PUT', '/settings/printer_name');
    expect('route' in matched && matched.route.method).toBe('PUT');
  });
});
