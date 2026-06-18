"use client";

import { useState } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const SIZE_PX = { sm: 24, default: 32, lg: 40 } as const;

export function UserAvatar({
  src,
  name,
  email,
  size = "sm",
}: {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: "sm" | "default" | "lg";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = (name ?? email ?? "?").trim().charAt(0).toUpperCase();
  const px = SIZE_PX[size];
  const showImage = Boolean(src) && src !== failedSrc;

  return (
    <Avatar size={size}>
      {showImage && src ? (
        <Image
          src={src}
          alt={name ?? "You"}
          width={px}
          height={px}
          className="aspect-square size-full rounded-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
