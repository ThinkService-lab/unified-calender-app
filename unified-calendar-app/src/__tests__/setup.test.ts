import fc from 'fast-check';

describe('Project Setup', () => {
  it('should have Jest configured correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have fast-check configured correctly', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 }
    );
  });
});
