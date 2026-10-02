// "Store bin": the yarns in one store's 4.95 € bin, measured from the user's photos (yarn_set_picture/, 8 photos).
// Each ball's color is the mean of the 35th–85th lightness percentile of a patch of the ball, white-balanced per photo
// against the light-gray terrazzo floor (so the store lighting and the phone's white balance don't tint it).
// Codes: Novita 7 Veljestä codes where the label was readable or the color matched the card (see below); House Onni
// yarns are ON1 / ON2; the denim ball's brand is unknown (X1). 100 g ≈ 200 m (aran weight). code | name | R | G | B.
//   170  Laivasto: 7 Veljestä · code from color
//   136  Lobelia: 7 Veljestä · code from color
//   103  Vesipisara: 7 Veljestä · label 182 103
//   011  Valkoinen: 7 Veljestä · code from color (or 010)
//   268  Auringonkukka: 7 Veljestä · label 182 268
//   273  Hapero: 7 Veljestä · label 182 273
//   7V   Ruskea: 7 Veljestä · code not visible
//   064  Korvasieni: 7 Veljestä · label 182 064
//   099  Noki: 7 Veljestä · label 182 099
//   ON1  Vaaleankeltainen: House Onni
//   ON2  Laventelinsininen: House Onni (probably)
//   X1   Farkunsininen: brand unknown
export const STORE_RAW = `
170|Laivasto|30|30|53
136|Lobelia|37|62|138
103|Vesipisara|122|142|176
011|Valkoinen|216|213|204
268|Auringonkukka|241|190|104
273|Hapero|177|113|63
7V|Ruskea|104|84|74
064|Korvasieni|78|62|67
099|Noki|23|22|27
ON1|Vaaleankeltainen|218|200|148
ON2|Laventelinsininen|155|173|216
X1|Farkunsininen|82|91|127
`;
