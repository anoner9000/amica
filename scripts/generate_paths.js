const fs = require('fs');
const fg = require('fast-glob');
const path = require('path');

const ROOT = path.join(__dirname, './../public');

const toPublicPath = (root, filePath) => filePath.split(root)[1];

const buildPaths = (root = ROOT) => {
  const bgImages = fg.globSync(root+"/bg/**/bg-*.jpg", {dot: true}).map((p) => toPublicPath(root, p));
  const vrmList = fg.globSync(root+"/vrm/**/*.vrm", {dot: true})
    .map((p) => toPublicPath(root, p))
    .filter((p) => !p.startsWith("/vrm/.private/"));
  const speechT5SpeakerEmbeddingsList = fg.globSync(root+"/speecht5_speaker_embeddings/**/*.bin", {dot: true}).map((p) => toPublicPath(root, p));
  const animationList = [].concat(
    fg.globSync(root+"/animations/**/*.vrma", {dot: true}).map((p) => toPublicPath(root, p)),
    fg.globSync(root+"/animations/**/*.fbx", {dot: true}).map((p) => toPublicPath(root, p))
  );

  return {
    bgImages,
    vrmList,
    speechT5SpeakerEmbeddingsList,
    animationList,
  };
};

const renderPaths = ({bgImages, vrmList, speechT5SpeakerEmbeddingsList, animationList}) => {
  let str = "";
  str += `export const bgImages = ${JSON.stringify(bgImages)};\n`;
  str += `export const vrmList = ${JSON.stringify(vrmList)};\n`;
  str += `export const speechT5SpeakerEmbeddingsList = ${JSON.stringify(speechT5SpeakerEmbeddingsList)};\n`;
  str += `export const animationList = ${JSON.stringify(animationList)};\n`;
  return str;
};

const writePaths = () => {
  fs.writeFileSync(path.join(__dirname, './../src/paths.ts'), renderPaths(buildPaths()));
};

if (require.main === module) {
  writePaths();
}

module.exports = {
  buildPaths,
  renderPaths,
  writePaths,
};
