// Leaves the Reels and Explore feeds. Single reels (/reel/...) still open.
onCleanupChange((options, path) => {
  if (options.instagramReels && /^\/(reels|explore)\//.test(path)) location.replace("/");
});
