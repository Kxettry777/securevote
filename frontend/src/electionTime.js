export function electionPhase(startsAt, endsAt, now) {
    if (now >= Date.parse(endsAt))
        return "ended";
    return now >= Date.parse(startsAt) ? "active" : "upcoming";
}
export function countdownParts(target, now) {
    const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000));
    return { days: Math.floor(seconds / 86400), hours: Math.floor(seconds / 3600) % 24,
        minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60 };
}
