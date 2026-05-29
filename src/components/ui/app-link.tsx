"use client";

import * as React from "react";
import { navigateTo, normalizeInternalHref } from "@/lib/navigation";

interface AppLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: React.ReactNode;
}

/**
 * Native anchor-based link component for internal navigation.
 *
 * Replaces next/link for internal routes inside the Tauri WebView.
 * next/link intercepts clicks but fails to complete the navigation in the
 * static-export Tauri build — using window.location.href directly bypasses
 * the broken client-side routing layer.
 *
 * The rendered href attribute uses the normalized form so right-click
 * "Copy link" / "Open in default browser" works correctly with the
 * trailing slash that the static export requires.
 */
export function AppLink({ href, children, onClick, ...rest }: AppLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle external / special links naturally
    if (/^(https?:|mailto:|tel:|blob:|data:)/.test(href)) return;
    if (href.startsWith("#")) return;

    // Let browser handle modifier-key clicks, middle-click, and special attributes
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    if (e.button !== 0) return; // non-left click
    if (rest.target === "_blank" || rest.download) return;

    // Allow the user's onClick handler to prevent navigation
    onClick?.(e);
    if (e.defaultPrevented) return;

    // Internal links: use native browser navigation
    e.preventDefault();
    navigateTo(href);
  };

  return (
    <a href={normalizeInternalHref(href)} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}