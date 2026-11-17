export function keepOpenForCallBar<T extends CustomEvent>(handler?: (event: T) => void) {
  return (event: T) => {
    if (event.target instanceof Element && event.target.closest("[data-call-bar]")) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
