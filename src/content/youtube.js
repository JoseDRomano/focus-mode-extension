// Opens Shorts in the regular player, which has no endless swipe feed.
onCleanupChange((options, path) => {
  const match = options.youtubeShorts && path.match(/^\/shorts\/([\w-]+)/);
  if (match) location.replace(`/watch?v=${match[1]}`);
});
