// Pattern 1: .then with destructuring
import('@ui/Icon/payment').then(({ Arrow, Card }) => {
  console.log(Arrow, Card);
});

// Pattern 2: .then with member access (React.lazy style)
const LazyIcon = lazy(async () =>
  import('@ui/Icon/ui').then((m) => ({
    default: m.PacmanBlack,
  })),
);

// Pattern 3: .then with arrow shorthand
import('@ui/Icon/ui').then(m => m.PacmanLight);

// Pattern 4: destructured await
const { Coins, Lock } = await import('@ui/Icon/ui');
