{
  stdenvNoCC,
  fetchurl,
  lib,
}:
stdenvNoCC.mkDerivation {
  pname = "bitwarden-agent-access";
  version = "0.11.0";
  src = fetchurl {
    url = "https://github.com/bitwarden/agent-access/releases/download/v0.11.0/aac-macos-aarch64.tar.gz";
    sha256 = "5d20923e4bb9649ef5df2798d9aa0e95b4a1840ce663d3091534177a118231c1";
  };
  sourceRoot = ".";
  dontBuild = true;
  dontStrip = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 aac "$out/bin/aac"
    runHook postInstall
  '';
  meta = {
    description = "Official Bitwarden Agent Access CLI";
    homepage = "https://github.com/bitwarden/agent-access";
    license = lib.licenses.asl20;
    platforms = [ "aarch64-darwin" ];
    mainProgram = "aac";
  };
}
