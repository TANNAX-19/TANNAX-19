App({
  onLaunch() {
    const { ensureSeedData } = require("./utils/store");
    const { fetchCurrentUser } = require("./utils/session");
    ensureSeedData();
    fetchCurrentUser();
  },
});
