// "Final v2": the user's final yarns, resampled. Same codes and names as js/final.js, measured more carefully:
// - Photos: yarn_set_final/ (each ball on white paper), auto-oriented (EXIF), 1000 px previews.
// - Yarn: two large boxes per ball on both sides of the label (~110–160k pixels), each checked on an overlay; the color is
//   the mean of the 70th–95th lightness percentile, i.e. the strands facing the light without the shine. (The first
//   Final set averaged 50–90 %, which mixed in shaded strands and made every color, white included, dull and gray.)
// - Paper: per photo the brightest even paper patch (spread ≤ 13) among candidates around the frame, i.e. paper in full
//   light, used per channel to remove the photo's color cast and exposure.
// - White is white: the white ball's lit color relative to its paper (0.93 / 0.89 / 0.89) sets the paper → output scale
//   for every photo, so F09 First Snow measures 240 240 240 and the others keep their true relation to it.
// - F10 Laivasto has no photo: Novita 7 Veljestä 170 from the yarn card, converted to this basis by interpolating
//   lightness (CIELAB L*) between the card's 099 Noki and 064 Korvasieni and their measured balls (Raven, Plum Bark),
//   keeping the card's hue. An estimate (the printed card crushes dark colors unevenly).
// Aran weight, 100 g ≈ 200 m. code | name | R | G | B.
export const FINAL2_RAW = `
F01|Raven|30|29|30
F02|Plum Bark|90|68|70
F03|Driftwood|124|100|85
F04|Fox|198|128|68
F05|Honeycomb|251|191|91
F06|Buttermilk|245|225|164
F07|Kingfisher|44|82|171
F08|Frost|146|171|193
F09|First Snow|240|240|240
F10|Laivasto|38|44|62
`;
