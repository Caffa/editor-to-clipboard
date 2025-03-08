# minor version bump 
npm version patch

# create the current_release directory if it does not exist
mkdir -p editor-to-clipboard

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js editor-to-clipboard
cp manifest.json editor-to-clipboard
cp styles.css editor-to-clipboard

# compress the current_release folder into a zip file
# zip -r release.zip current_release
zip -vr editor-to-clipboard.zip editor-to-clipboard -x "*.DS_Store"

mv editor-to-clipboard.zip release.zip

# remove the current_release folder
# rm -rf editor-to-clipboard

git add -A
git commit -m "Prepare for Git Release"
# git push origin main
echo "git push origin Version"
echo 'TODO gh release create 1.0.Version release.zip main.js manifest.json styles.css --title "TITLE" --notes "NOTE"'