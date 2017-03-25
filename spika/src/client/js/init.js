(function(global) {

    "use strict;"

    var Config = {};

    Config.apiBaseUrl = "https://butler-hero.org/spika/v1";
    Config.socketUrl = "https://butler-hero.org/spika";
    
    Config.googleMapAPIKey = "";
    
    Config.defaultContainer = "#spika-container";
    Config.lang = "en";
    Config.showSidebar = true;
    Config.showTitlebar = true;
    Config.useBothSide = false;
    Config.thumbnailHeight = 256;
    
    // Exports ----------------------------------------------
    module["exports"] = Config;

})((this || 0).self || global);
