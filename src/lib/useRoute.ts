import { useEffect, useState } from "react";

export type Route =
  | { name: "companies" }
  | { name: "quotes" }
  | { name: "bast" }
  | { name: "lost" }
  | { name: "corporate" }
  | { name: "robot" };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "penawaran") return { name: "quotes" };
  if (path === "bast") return { name: "bast" };
  if (path === "cancel" || path === "tidak-jadi") return { name: "lost" };
  if (path === "corporate") return { name: "corporate" };
  if (path === "robot") return { name: "robot" };
  return { name: "companies" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

export function navigate(path: string) {
  const target = `#${path}`;
  if (window.location.hash === target) return;
  window.location.hash = path;
  window.scrollTo({ top: 0 });
}
