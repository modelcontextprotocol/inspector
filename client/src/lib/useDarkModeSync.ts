import { useEffect } from "react";

// Listen for changes to the user's preferred color scheme
const useDarkModeSync = () => {
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)",
    );
    const handleDarkModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    if (darkModeMediaQuery.matches) {
      document.documentElement.classList.add("dark");
    }

    darkModeMediaQuery.addEventListener("change", handleDarkModeChange);

    return () => {
      darkModeMediaQuery.removeEventListener("change", handleDarkModeChange);
    };
  }, []);
};

export default useDarkModeSync;
