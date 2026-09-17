import { useState } from "react";

// An optional glob lets the app build before the owner adds the photograph.
const images = import.meta.glob("./assets/profile.jpg", { eager: true, query: "?url", import: "default" });
const source = images["./assets/profile.jpg"];

export function ProfileImage({ className = "", alt = "Profile image" }) {
  const [failedSource, setFailedSource] = useState(null);
  return source && failedSource !== source
    ? <img className={`profile-image ${className}`} src={source} alt={alt} onError={() => setFailedSource(source)} />
    : <span className={`profile-image profile-placeholder ${className}`} role="img" aria-label={alt}><svg viewBox="0 0 24 24" width="60%" height="60%" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/></svg></span>;
}
