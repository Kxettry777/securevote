import { useState } from "react";

// An optional glob lets the app build before the owner adds the photograph.
const images = import.meta.glob("./assets/profile.jpg", { eager: true, query: "?url", import: "default" });
const source = images["./assets/profile.jpg"];

export function ProfileImage({ className = "", alt = "Profile image" }) {
  const [failedSource, setFailedSource] = useState(null);
  return source && failedSource !== source
    ? <img className={`profile-image ${className}`} src={source} alt={alt} onError={() => setFailedSource(source)} />
    : <span className={`profile-image profile-placeholder ${className}`} role="img" aria-label={alt}>SV</span>;
}
