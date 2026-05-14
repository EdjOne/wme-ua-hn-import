// ==UserScript==
// @name         WME Quick RPP Importer - Ukraine
// @namespace    https://github.com/EdjOne/wme-ua-hn-import
// @version    1.7.13
// @description  Швидкий імпорт RPP UA 🇺🇦
// @author       Edj (адаптація на основі ThatByte / zigapovhe)
// @downloadURL  https://github.com/EdjOne/wme-ua-hn-import/raw/refs/heads/main/src/ua-hn-import.user.js
// @updateURL    https://github.com/EdjOne/wme-ua-hn-import/raw/refs/heads/main/src/ua-hn-import.user.js
// @icon         https://raw.githubusercontent.com/EdjOne/wme-ua-hn-import/main/src/icon48.png
// @icon64       https://raw.githubusercontent.com/EdjOne/wme-ua-hn-import/main/src/icon64.png
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/*
// @match        https://livemap.waze.com/*
// @match        https://www.waze.com/*
// @exclude      https://www.waze.com/user/editor*
// @connect      stat.waze.com.ua
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @license      MIT
// @noframes
// ==/UserScript==

/*
 * Ukrainian adaptation based on:
 * - https://github.com/zigapovhe/wme-sl-hn-import (Slovenia version)
 * - https://github.com/waze-ua/WME-UA-address-data (UA address polygons)
 *
 * Data source: Держреєстр (stat.waze.com.ua) — Waze Ukraine address database
 * Projection: WGS84 (EPSG:4326) — no reprojection needed
 */

/* global I18n, getWmeSdk, unsafeWindow */

(function () {
  'use strict';

  let wmeSDK;
  const SDK_LAYER_NAME = 'qhnua-sdk';
  const MAX_CLICK_DISTANCE_PX = 25;
  const MAX_RPP_CONFLICT_DISTANCE = 10;

  const UA_BUFFER_DEFAULT = 200; // reduced radius to avoid timeouts

  // Common Ukrainian street name abbreviations
  const ABBREVIATIONS = {
    'вул.': 'вулиця',
    'пров.': 'провулок',
    'просп.': 'проспект',
    'бульв.': 'бульвар',
    'пл.': 'площа',
    'м-н': 'майдан',
    'узв.': 'узвіз',
    'наб.': 'набережна',
    'шосе': 'шосе',
    'туп.': 'тупик',
    'пр.': 'проїзд',
    'спуск': 'узвіз'
  };

  // Full street type names to remove (for suffix stripping: "Успенська вулиця" → "Успенська")
  const STREET_TYPES_FULL = [
    'вулиця', 'провулок', 'проспект', 'бульвар', 'площа', 'майдан',
    'узвіз', 'набережна', 'шосе', 'тупик', 'проїзд'
  ];

  // Street rename mapping (Odessa only - 380 renamed streets 1995-2026)
  // Source: https://odeskyividhuk.github.io/streets/
  // Format: "old_name": "current_name"
  const STREET_RENAMES = {
    "Виставочна": "Виставкова",
    "Волниста": "Хвиляста",
    "провулок Грузовий": "провулок Вантажний",
    "Камишова": "Комишева",
    "Кузнечна": "Ковальська",
    "Косвена": "Скісна",
    "провулок Лодочний": "провулок Човновий",
    "Лучиста": "Промениста",
    "Наклонна": "Похилиста",
    "Обільна": "Рясна",
    "провулок 1-й Обільний": "провулок 1-й Рясний",
    "провулок 2-й Обільний": "провулок 2-й Рясний",
    "Отрадна": "Відрадна",
    "Просьолочна": "Путівна",
    "Разумовська": "Розумовська",
    "Рощева": "Гайова",
    "Уютна": "Затишна",
    "площа Ярмарочна": "площа Ярмаркова",
    "Олександра Вронського": "Композитора Вербицького",
    "Єліна": "Ференца Ліста",
    "Кондренка": "Ближні Млини",
    "Корнюшина": "Миколи Лисенка",
    "Кострова": "Ольги Благовидової",
    "Перепечка": "Композитора Лятошинського",
    "провулок Красних Зорь": "провулок Стурдзовський",
    "Брестська": "Берестейська",
    "Курганська": "Курганна",
    "Тупик Байкал": "Калинова",
    "проспект Олександрівський": "проспект Українських Героїв",
    "Ляпідевського": "Раллі",
    "Зої Космодем’янської": "Мускатна",
    "провулок Зої Космодем’янської": "провулок Аліберне",
    "провулок Ушакова": "провулок Рислінга",
    "Декабристів": "Мінаєвська",
    "провулок Краснослобідський": "провулок Гетьмана Петра Дорошенка",
    "провулок Ляпунова": "провулок Ляпунових",
    "провулок Некрасова": "провулок Отонівський",
    "провулок Нахімова": "провулок Барятинський",
    "Єлисаветинська": "Університетська",
    "Генерала Ватутіна": "Костецька",
    "провулок Генерала Вишневського": "провулок Анатра",
    "Кристаловського": "Композитора Бортнянського",
    "Смоленська": "Леоніда Смоленського",
    "Скворцова": "Мальовнича",
    "Академіка Вільямса": "Євгена Чикаленка",
    "Ванцетті": "Миколи Куліша",
    "Ванцетті провулок": "Гіацинтовий провулок",
    "Васнецова": "Ждахи",
    "Васнецова 2-й провулок": "Михайла Слабченка провулок",
    "Глазунова": "Бориса Нечерди",
    "Достоєвського": "Драгоманова",
    "Достоєвського провулок": "Історичний провулок",
    "Композитора Глинки": "Музична",
    "Композитора Глинки провулок": "Мелодійний провулок",
    "Космонавта Комарова": "Михайла Комарова",
    "Макаренка": "Лігінська",
    "Олександра Невського": "Сергія Шелухіна",
    "Невського 1-й провулок": "Климовича провулок",
    "Невського 2-й провулок": "Чехівського провулок",
    "Невського 3-й провулок": "Василя Кричевського провулок",
    "Невського 4-й провулок": "Павла Чубинського провулок",
    "Невського 5-й провулок": "Майка Йогансена провулок",
    "Псковська": "Петриківська",
    "Псковський провулок": "Опішнянський провулок",
    "Сибірська": "Дитяча",
    "Тульська": "Академіка Вернадського",
    "Уральська": "Дмитра Яворницького",
    "Уральський провулок": "Шкурупія провулок",
    "Уральський-Тупіковий провулок": "Гарбузовий провулок",
    "Шишкіна": "Наукова",
    "Шишкіна провулок": "Філософський провулок",
    "Шишкіна 2-й провулок": "Математичний провулок",
    "Шишкіна 3-й провулок": "Біологічний провулок",
    "вулиця 8 Березня": "Вікандера і Ларсена",
    "лінія 1-а 8 Березня": "вулиця Метизна",
    "лінія 2-а 8 Березня": "вулиця Килимова",
    "лінія 5-а 8 Березня": "вулиця Бондарна",
    "провулок 1-й 8 Березня": "провулок Технарьський",
    "провулок 2-й 8 Березня": "провулок Арковий",
    "провулок 3-й 8 Березня": "провулок Паркетний",
    "провулок 4-й 8 Березня": "провулок Корковий",
    "провулок 6-й 8 Березня": "провулок Анкерний",
    "провулок 8-й 8 Березня": "провулок Меблевий",
    "Гладкова": "Каменярів",
    "Грибоєдова": "Джинестрівська",
    "Далекосхідна": "Трусовська",
    "Кутузова": "Кошелевська",
    "Ломоносова": "Котлєєвська",
    "Цимлянська": "Дембровська",
    "Ширшова": "Архітектора Нештурхи",
    "Верещагіна провулок": "Академіка Липського провулок",
    "Волзький провулок": "Олександрійський провулок",
    "Сквер Вітте": "Сквер Ефрусі",
    "Лермонтовський провулок": "Джевецького провулок",
    "Каманіна провулок": "Кортацці провулок",
    "Кренкеля провулок": "Дур’янівський провулок",
    "Маяковського провулок": "Футуристів провулок",
    "Сєрова": "Майстрова",
    "Гастелло": "Малішевського",
    "Мінська": "Йозефа Прибіка",
    "Новікова 2-га": "Родоканакі",
    "Плієва": "Бродська",
    "Софії Перовської": "Мармурова",
    "Сурикова": "Столярського",
    "Чернишевського": "Гранітна",
    "Генерала Бочарова": "Владислава Бувалкіна",
    "Махачкалінська": "Віталія Блажка",
    "Каманіна": "Валерія Самофалова",
    "Марії Демченко": "Дениса Максишка",
    "Якутська": "Ігоря Бедзая",
    "Авдєєва-Чорноморського": "Одеської громади",
    "Академіка Вавілова": "Сергія Єфремова",
    "Академіка Вільямса провулок": "Карпенка-Карого провулок",
    "Байкальська": "Юрія Єгорова",
    "Білоруська": "Кастуся Калиновського",
    "Гаршина": "Давида Бурлюка",
    "Гаршина провулок": "Соні Делоне провулок",
    "Дмитрія Донського провулок": "Лазурського провулок",
    "Дмитрія Донського": "Дмитріївська",
    "Єнісейська": "Юрія Коваленка",
    "Іванова 1-й провулок": "Мерло провулок",
    "Іванова 2-й провулок": "Каберне провулок",
    "Магнітогорська": "Михайла Врубеля",
    "Магнітогорський провулок": "Адольфа Лози провулок",
    "провулок Магнітогорський 2-й": "провулок Сергія Параджанова",
    "Макарова": "Контрадмірала Остроградського",
    "Новгородська": "Михайла Жука",
    "провулок Новгородський": "провулок Дворникова",
    "провулок Новгородський 2-й": "провулок Теофіла Фраєрмана",
    "Омська": "Василя Берладяну",
    "Петрашевського": "Леся Курбаса",
    "Писарева": "Бориса Едуардса",
    "Тимірязєва": "Айвазовського",
    "Шолохова провулок": "Волокидіна провулок",
    "Щукіна провулок": "Медовий провулок",
    "Більшовицький провулок": "Савранський провулок",
    "Воронезька": "Ізюмська",
    "лінія 3-я 8 Березня": "Гобеленова",
    "лінія 4-а 8 Березня": "вулиця Фахова",
    "провулок 5-й 8 Березня": "провулок Кодимський",
    "провулок 7-й 8 Березня": "провулок Бейтельсбахера",
    "провулок 9-й 8 Березня": "провулок Волтона",
    "узвіз 8 березня": "узвіз Віктора Скаржинського",
    "Дем’янова": "Грушева",
    "Державіна": "Глаубермана",
    "Державіна провулок": "Квантовий провулок",
    "Зоринська": "Караїмська",
    "Красносільська": "Ольвійська",
    "Крилова": "Юзефа Крашевського",
    "Курська": "Бахмутська",
    "Лізи Чайкіної": "Шевальових",
    "Миколи Гефта": "Ганса Германа",
    "Мічуріна площа": "Волова площа",
    "Молодогвардійська": "Чайкова",
    "Нікітіна": "Шполянська",
    "провулок Орловський": "провулок Надії Пучковської",
    "провулок Орловський 1-й": "провулок Професора Беркевича",
    "провулок Орловський 2-й": "провулок Професора Кононовича",
    "Ростовська": "Маріупольська",
    "Салтикова-Щедріна": "Пилипа Орлика",
    "Стахановський 4-й провулок": "Школярський провулок",
    "Суворовська 1-ша": "Петра Біциллі",
    "Суворовська 2-га": "Бардаха",
    "Суворовська 3-тя": "Миколи Пильчикова",
    "Суворовська 4-та": "Йосипа Фішера",
    "Суворовська 5-та": "Цесевича",
    "Суворовська 6-та": "Баринштейна",
    "Суворовська 7-ма": "Євгена Крамаренка",
    "Суворовська 8-ма": "Володимира Антоновича",
    "Суворовська 9-та": "Квітки-Основ’яненка",
    "Суворовська 10-та": "Олександра Богомольця",
    "Суворовська 11-та": "Яна Длугоша",
    "Суворовська 12-та": "Юрія Кондратюка",
    "Суворовська 13-та": "Миколи Костомарова",
    "Суворовська 14-та": "Марка Крейна",
    "Суворовська 15-та": "Скліфосовського",
    "Тургенєва": "Андрія Сови",
    "Червоний сквер": "Десмета сквер",
    "Єлисаветградський провулок": "Халайджогло провулок",
    "Катерининська": "Європейська",
    "Катерининська площа": "Європейська площа",
    "Леваневського провулок": "Гонсіоровського провулок",
    "Леваневського тупик": "Толвінського провулок",
    "Лідерсовський бульвар": "бульвар Гетьмана Сагайдачного",
    "Маршала Говорова": "Добровольців",
    "Олександра Матросова провулок": "Валерія Лобановського провулок",
    "Посмітного": "Балтиморська",
    "провулок Пролетарський": "провулок Іони Отаманського",
    "провулок Пролетарський 3-й": "провулок Географічний",
    "Слєпньова": "Донорська",
    "провулок Черепанових 2-й": "провулок Барвінковий",
    "Амурська": "Острозька",
    "Амурський 1-й провулок": "Кам’янецький провулок",
    "Амурський 2-й провулок": "Глухівський провулок",
    "Амурський 3-й провулок": "Волинський провулок",
    "Амурський 4-й провулок": "Кременецький провулок",
    "Ангарська": "Буджацька",
    "Бородінська": "Героїв Зміїного",
    "Бородінський провулок": "Кінбурнський провулок",
    "Братська": "Вінницька",
    "Віри Фігнер": "Буковецького",
    "Волоколамська": "Батуринська",
    "Генерала Доватора": "Хортицька",
    "Дежньова провулок": "Миргородський провулок",
    "Єрмака провулок": "Охтирський провулок",
    "Желябова": "Владислава Домбровського",
    "Казанська": "Ізмаїльська",
    "Качалова": "Симфонічна",
    "Кибальчича": "Луїджі Іоріні",
    "Леонова": "Олешківська",
    "Марата 1-й провулок": "Сливовий провулок",
    "Марата 2-й провулок": "Чорничний провулок",
    "Марата": "Фруктова",
    "Метрополітенівський провулок": "Флейтовий провулок",
    "Мічуріна": "Петра Болбочана",
    "провулок Москвіна": "провулок Литавровий",
    "Новомосковська дорога": "Чигиринська",
    "Онезька": "Евлії Челебі",
    "Пестеля": "Саймона Літмана",
    "Пестеля провулок": "Цукровий провулок",
    "Ползунова": "Буковинська",
    "Ползунова провулок": "Хотинський провулок",
    "Пугачова": "Персикова",
    "Радищева провулок": "Прилуцький провулок",
    "Самарська": "Обліпихова",
    "Степана Разіна": "Малинова",
    "Стєклова": "Томатна",
    "Сурикова 1-й провулок": "Лірний провулок",
    "Сурикова 2-й провулок": "Бандурний провулок",
    "Трудових резервів": "Олександра Білостінного",
    "Яблочкіної провулок": "Альтовий провулок",
    "Адмірала Лазарєва": "Михайла Болтенка",
    "Академіка Воробйова": "Віталія Нестеренка",
    "проспект Академіка Глушка": "проспект Князя Ярослава Мудрого",
    "Академіка Панкратової": "Дмитра Сигаревича",
    "Амвросія Бучми": "Михайла Білинського",
    "провулок Апполона Скальковського": "провулок Зої Пасічної",
    "Армійська": "Незалежності",
    "Бабеля": "Дмитра Іванова",
    "Багрицького": "Михайла Бойчука",
    "провулок Бадаєва": "провулок Марії Станішевської",
    "провулок Барятинський": "провулок Дмитра Лесича",
    "Братів Поджіо": "Василя Фащенка",
    "Буніна": "Ніни Строкатої",
    "Висоцького": "Ярослава Баїса",
    "Віце-адмірала Азарова": "Андрія Гулого-Гуленка",
    "провулок Віце-адмірала Жукова": "провулок Івана Луценка",
    "Віри Інбер": "Володимира Рутківського",
    "проспект Гагаріна": "проспект Лесі Українки",
    "Гагарінське плато": "Аркадійське плато",
    "Гаріна": "Павла Клепацького",
    "Гвардійська": "Андрія Музичка",
    "Генерала Гудовича": "Станіслава Узікова",
    "Генерала Петрова": "Євгена Танцюри",
    "Генерала Ратова": "Ростислава Палецького",
    "Генерала Швигіна": "Григорія Зленка",
    "Генерала Цвєтаєва": "Геннадія Афанасьєва",
    "Герцена": "Галини Могильницької",
    "Градоначальницька": "Тараса Кузьміна",
    "Дворянська": "Всеволода Змієнка",
    "проспект Добровольського": "проспект Князя Володимира Великого",
    "площа Думська": "площа Біржова",
    "Дунаєвського": "Олександра Кошиця",
    "бульвар Михайла Жванецького": "бульвар Військово-морських сил",
    "Жуковського": "Святослава Караванського",
    "Ільфа і Петрова": "Сім’ї Глодан",
    "провулок Інтернаціональний": "провулок Сергія Коновалова",
    "провулок Катаєва": "провулок Бориса Айзенберга",
    "Князівська": "Олексія Маркевича",
    "Коблевська": "Павла Зеленого",
    "Контр-адмірала Луніна": "Віталія Гуляєва",
    "провулок Короленка": "провулок Ігоря Балмагії",
    "Леваневського": "Січових стрільців",
    "провулок Леваневського": "провулок Січовий",
    "Лейтенанта Шмідта": "Олександра Станкова",
    "провулок Лермонтовський 2й": "провулок Госпітальєрів",
    "Льва Толстого": "Кіри Муратової",
    "площа Льва Толстого": "площа Менделя Сфоріма",
    "провулок Ляпунових": "провулок Олександра Ройтбурда",
    "Маріїнська": "Михайла Омеляновича-Павленка",
    "узвіз Марінеско": "узвіз Віталія Блажка",
    "Маршала Бабаджаняна": "Івана Фунтового",
    "Маршала Малиновського": "Олексія Вадатурського",
    "провулок Мічуріна": "провулок Маргарити Ніколаєвої",
    "провулок Митракова": "провулок Олекси Воропая",
    "Недєліна": "Анатолія Бачинського",
    "провулок Олександра Стурдзи": "провулок Леоніда Осики",
    "Осипова": "Вадима Корженка",
    "Паустовського": "28-ї бригади",
    "Петра Біциллі": "Олександра Болдирєва",
    "провулок Ползунова 2й": "провулок Георгія Гусака-Гусаченка",
    "Політкаторжан": "Архітектора Івана Яценка",
    "Пушкінська": "Італійська",
    "Романа Кармена": "Решата Аметова",
    "Сабанеєв міст": "Миколи Савича",
    "Сквер Серединський": "Сквер Дмитра Дорошенка",
    "Спартаківська": "Ганни Михайленко",
    "провулок Спартаківський": "провулок Костянтина Пігрова",
    "Строганова": "Максима Чайки",
    "провулок Стурдзовський": "провулок Володимира Яковлева",
    "провулок Тимірязєва 1й": "провулок Гетьманський",
    "провулок Тимірязєва 2й": "провулок Гайдамацький",
    "провулок Тимірязєва 3й": "провулок Козацький",
    "провулок Тимірязєва 4й": "провулок Характерників",
    "провулок Тимірязєва 5й": "провулок Кобзарський",
    "Толбухіна": "Георгія Липського",
    "провулок Толбухіна": "провулок Людмили Семикіної",
    "площа Толбухіна": "площа Трибуни героїв",
    "провулок Чайковського": "провулок Театральний",
    "Черняховського": "Артура Савельєва",
    "Юрія Олеші": "Віталія Боровика",
    "Середня": "Олександра Свіща",
    "Чапаєва (Пересипський район)": "В'ячеслава Кирилова",
    "Піонерська": "Академічна",
    "Жовтневої революції": "Юхима Геллера",
    "Комінтерну": "Петра Лещенка",
    "Петровського": "Юхима Фесенка",
    "Колгоспна": "Йосипа Тимченка",
    "провулок Колгоспний 1-й": "провулок Сергія Уточкіна",
    "провулок Колгоспний 2-й": "провулок Сергія Ейзенштейна",
    "Щорса": "Святослава Ріхтера",
    "провулок Щорса": "провулок Людмили Гінзбург",
    "Затонського": "Давида Ойстраха",
    "провулок Стахановський 1-й": "провулок Данила Крижанівського",
    "провулок Стахановський 2-й": "провулок Аполона Скальковського",
    "провулок Стахановський 3-й": "провулок Олександра Стурдзи",
    "Ленінградське шосе": "Київське шосе",
    "провулок Колгоспний": "провулок Різницький",
    "Бабушкіна": "Семена Яхненка",
    "провулок Бабушкіна": "провулок Всеволода Змієнка",
    "Бадаєва": "Петра Івахненка",
    "Бірюкова": "Ігоря Іванова",
    "Бєлінського": "Леонтовича",
    "Благоєва": "Святих Кирила та Мефодія",
    "провулок Богданова": "провулок Вільгельма Габсбурга",
    "Боженка": "Іоганна Гена",
    "Валентини Терешкової": "Героїв Крут",
    "Гайдара": "Івана та Юрія Лип",
    "Героїв Комсомольців": "Миколи Міхновського",
    "провулок Героїв Комсомольців": "провулок Євгена Бандуренка",
    "Героїв Сталінграда": "Героїв оборони Одеси",
    "Гончарова": "Бориса Жолкова",
    "Дніпропетровська дорога": "Семена Палія",
    "Дундича": "Миколи Стражеска",
    "Конноармійська": "Івана Луценка",
    "Крупської": "Семена Крупника",
    "Карла Лібкнехта": "Миколи Троїцького",
    "провулок Карла Лібкнехта": "провулок Отамана Кощового",
    "Красних зорь": "Бернардацці",
    "Ленінградська": "Олександра Кутузакія",
    "проспект Маршала Жукова": "проспект Небесної Сотні",
    "Оборони Ленінграда": "Нечуя-Левицького",
    "Обнорського": "Миколи Аркаса",
    "Одинцова": "Олексія Косяченка",
    "Островського": "Івана Мазепи",
    "провулок Піонерський": "провулок Ліверпульський",
    "Правди": "Просвіти",
    "провулок Правди": "провулок Гетьманський",
    "провулок Союзний": "провулок Олександра Юрженка",
    "провулок Тупиковий-Пролетарський": "провулок Юрія Касима",
    "Фурманова": "Дмитра Донцова",
    "провулок Фурманова": "провулок Олени Теліги",
    "Чапаєва": "В'ячеслава Кирилова",
    "провулок Чапаєвський": "провулок Петра Калнишевського",
    "провулок Чапаєвський 1-й": "провулок Володимира Терещенка",
    "провулок Чапаєвський 2-й": "провулок Олега Андрійця",
    "провулок Чапаєвський 3-й": "провулок Бориса Кифоренка",
    "провулок Чапаєвський 4-й": "провулок Віктора Діхтієвського",
    "провулок Чапаєвський 5-й": "провулок Ігоря Кисельова",
    "провулок Чапаєвський 6-й": "провулок Олега Стороженка",
    "провулок Чапаєвський 7-й": "провулок Юрія Асєєва",
    "провулок Чапаєвський 8-й": "провулок Олександра Пресича",
    "провулок Чапаєвський 9-й": "провулок Неплія",
    "25-ї Чапаєвської дивізії": "Інглезі",
    "Червоних партизанів": "Володимира Івасюка",
    "провулок Червоних партизанів": "провулок Миколи Бокаріуса",
    "Шестакова": "Шептицького",
    "Ярослава Галана": "Романа Шухевича",
    "Заславського": "Бориса Літвака",
    "Краснослобідська": "Праведників світу"
  };

  // Build reverse mapping for bidirectional lookup (Держреєстр may have old or new name)
  const STREET_RENAMES_REVERSE = {};
  for (const [old, current] of Object.entries(STREET_RENAMES)) {
    STREET_RENAMES_REVERSE[current] = old;
  }

  function applyStreetRenames(name) {
    return STREET_RENAMES[name] || name;
  }

  const LS = {
    getBuffer()       { return Number(localStorage.getItem('qhnua-buffer') ?? '500'); },
    setBuffer(v)      { localStorage.setItem('qhnua-buffer', String(v)); },
    getLayerVisible() { return localStorage.getItem('qhnua-layer-visible') === '1'; },
    setLayerVisible(v){ localStorage.setItem('qhnua-layer-visible', v ? '1' : '0'); },
    getSelectedOnly() { return localStorage.getItem('qhnua-selected-only') === '1'; },
    setSelectedOnly(v){ localStorage.setItem('qhnua-selected-only', v ? '1' : '0'); }
  };

  const toast = (msg, type = 'info') => {
    try {
      if (wmeSDK?.Notifications?.show) {
        wmeSDK.Notifications.show({ text: msg, type, timeout: 3500 });
      } else {
        console.info(`[UA-RPP] ${msg}`);
      }
    } catch (_) {
      console.info(`[UA-RPP] ${msg}`);
    }
  };

  function normalizeStreetName(name) {
    return String(name).toLowerCase().replace(/\s+/g, '_');
  }

  // Escape HTML special characters for safe attribute insertion
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Expand abbreviations and normalize for comparison
  function normalizeForComparison(name) {
    let normalized = String(name).trim();

    // Apply street renames first (check both old->new and new->old)
    // Держреєстр data may have either old or new street names
    const lower = normalized.toLowerCase();
    normalized = STREET_RENAMES[normalized] || STREET_RENAMES[lower] ||
                 STREET_RENAMES_REVERSE[normalized] || STREET_RENAMES_REVERSE[lower] || normalized;

    // Now lowercase and expand abbreviations
    normalized = normalized.toLowerCase();

    // Remove street type prefixes (вул., пров., просп., etc.) from start of string
    for (const abbrev of Object.keys(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('^' + escapedAbbrev + '\\s*', 'i');
      normalized = normalized.replace(regex, '');
    }

    // Remove street type suffixes (пров., вул., просп. etc.) from end of string
    for (const abbrev of Object.keys(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('\\s*' + escapedAbbrev + '$', 'i');
      normalized = normalized.replace(regex, '');
    }

    for (const [abbrev, full] of Object.entries(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('(^|\\s)' + escapedAbbrev + '(?=\\s|$)', 'gi');
      normalized = normalized.replace(regex, '$1' + full);
    }

    // Remove full street type suffixes (вулиця, провулок etc.) from end AND start of string
    for (const type of STREET_TYPES_FULL) {
      const escapedType = type.replace(/\s/g, '\\s');
      // From end
      let regex = new RegExp('\\s+' + escapedType + '$', 'i');
      normalized = normalized.replace(regex, '');
      // From start
      regex = new RegExp('^' + escapedType + '\\s*', 'i');
      normalized = normalized.replace(regex, '');
    }

    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized;
  }

  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

// Normalize house number: fix fractions and letter case
  // - Fix "7/ 1" → "7/1" (remove space before /)
  // - Fix incomplete fraction "2/" → "2/1"
  // - Letter numbers: uppercase Cyrillic except І, З, О → lowercase і, з, о
  // - No space between digit and letter: "2А" not "2 А"
  function normalizeHouseNumber(num) {
    if (!num) return num;
    let normalized = String(num).trim();
    
    // Fix fractions: "7/ 1" → "7/1" (space after / or before digit)
    normalized = normalized.replace(/\s*\/\s*/g, '/');
    
    // Fix incomplete fraction: "2/" → "2/1"
    normalized = normalized.replace(/\/$/, '/1');
    
    // Ensure no space between digit and letter: "2 А" → "2А"
    normalized = normalized.replace(/(\d)\s+([А-Яа-яІіЇїЄєҐґ])/g, '$1$2');
    
    // Uppercase Cyrillic letters, but І, З, О stay lowercase і, з, о
    // Only for letter suffix at the end (e.g., "51а" → "51А", "51з" stays "51з")
    normalized = normalized.replace(/([а-яіїєґ])$/g, (match) => {
      const lowerMap = { 'і': 'і', 'з': 'з', 'о': 'о' };
      return lowerMap[match] || match.toUpperCase();
    });
    
    return normalized;
  }

  // Calculate similarity between two strings (0-1)
  function calculateSimilarity(str1, str2) {
    const s1 = normalizeForComparison(str1);
    const s2 = normalizeForComparison(str2);

    // Exact match after normalization
    if (s1 === s2) return 1.0;

    // Match without diacritics
    if (removeDiacritics(s1) === removeDiacritics(s2)) return 0.95;

    // Word permutation check (e.g., "флотилії дунайської" vs "дунайської флотилії")
    const words1 = s1.split(/\s+/).filter(w => w.length > 2);
    const words2 = s2.split(/\s+/).filter(w => w.length > 2);
    if (words1.length === words2.length && words1.length > 1) {
      const sorted1 = [...words1].sort().join(' ');
      const sorted2 = [...words2].sort().join(' ');
      if (sorted1 === sorted2) return 0.98;
    }

    // Substring check (e.g., "Весела" vs "вул. Весела")
    if (s1.includes(s2) || s2.includes(s1)) return 0.96;

    // Levenshtein distance based similarity
    const distance = levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    const similarity = 1 - (distance / maxLen);

    return similarity;
  }

  // Levenshtein distance implementation
  function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  function getRPGeometry(hn) {
    if (!hn?.geometry?.coordinates) return null;
    return { x: hn.geometry.coordinates[0], y: hn.geometry.coordinates[1] };
  }

  function getSelectedSegments() {
    const sel = wmeSDK.Editing.getSelection();
    if (!sel || sel.objectType !== 'segment') return [];
    return sel.ids
      .map(id => wmeSDK.DataModel.Segments.getById({ segmentId: id }))
      .filter(Boolean);
  }

  // Check if a house number has a nearby conflict.*RPP within threshold distance)
  function hasConflict(hn, wx, wy, entry) {
    if (!entry?.items?.length) return false;
    for (const it of entry.items) {
      if (!it || it.x == null || it.y == null) continue;
      if (it.num !== hn) {
        const dx = wx - it.x, dy = wy - it.y;
        if (dx * dx + dy * dy <= MAX_RPP_CONFLICT_DISTANCE * MAX_RPP_CONFLICT_DISTANCE) {
          return true;
        }
      }
    }
    return false;
  }

  // Fetch addresses from Waze Ukraine state register (stat.waze.com.ua)
  function fetchAddressesWaze(centerLat, centerLon, radius) {
    return new Promise((resolve, reject) => {
      const url = `https://stat.waze.com.ua/address_map/address_map.php?lat=${centerLat}&lon=${centerLon}&radius=${radius}`;

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 30000,
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);
            const polygons = data?.data?.polygons?.Default || [];

            const features = [];
            const streetNames = {};
            const streets = {};

            for (const item of polygons) {
              if (!item.center || typeof item.center !== 'string') continue;
              const center = item.center.split(';');
              const lat = parseFloat(center[0]);
              const lon = parseFloat(center[1]);
              if (isNaN(lat) || isNaN(lon)) continue;

              const nameParts = item.name.trim().split('\n').map(p => p.trim()).filter(p => p);

              // Robust parsing for address_map.php format:
              // Format example: "Одеська обл.\n Овідіопольський р-н\n с. Мізікевича\n ж/масив Ульянівка\n масив Радужний\n ділянка 32"
              // Last line contains house number (ділянка N, масив N, діл. N, буд. N, кв. N etc.)
              let city = '';
              let street = '';
              let houseNumber = '';
              let district = '';

// Find city (line starting with "с."/"м.", "село", or contains city name pattern)
              for (const part of nameParts) {
                // Match "с. Майори", "с.Майори", "м. Київ", "село Майори", "село Майори"
                const cityMatch = part.match(/^(с\.|м\.|село|місто)\s*([А-Яа-яІіЇїЄєҐґ'\\-\\s]+)|^(с|м|село|місто)\s*([А-Яа-яІіЇїЄєҐґ'\\-\\s]+)/i);
                if (cityMatch) {
                  city = (cityMatch[2] || cityMatch[4] || '').trim();
                  break;
                }
              }

              // Extract house number from last line (ділянка N, масив N, діл. N, буд. N, кв. N etc.)
              const lastLine = nameParts[nameParts.length - 1] || '';
// Normalize whitespace around fractions: "2/ 17" → "2/17"
              const normalizedLine = lastLine.replace(/\s*\/\s*/g, '/');
              // Skip "б/н" (без номера), "будинок", etc. - require actual number
              if (lastLine.includes('б/н') || lastLine.includes('без номера')) {
                continue;
              }
              const numMatch = normalizedLine.match(/(?:ділянка|масив|діл\.|буд\.|кв\.|№)?\s*(\d+(?:\/\d+)?[а-яА-Я]?)/i);
              if (numMatch) {
                houseNumber = normalizeHouseNumber(numMatch[1]);
              }

              // Extract street - look for вул. or пров. or use last available line before number
              for (let i = nameParts.length - 2; i >= 0; i--) {
                if (/^вул\.|^пров\./i.test(nameParts[i])) {
                  street = nameParts[i].replace(/^(вул\.|пров\.)/i, '').trim();
                  break;
                }
              }
              // If no street found, use second-to-last line as street (for масив/ділянка without вул.)
              if (!street && nameParts.length >= 2) {
                street = nameParts[nameParts.length - 2].replace(/^(с\.|м\.|ж\/?масив|масив)/i, '').trim();
              }

              // Extract district (line with "р-н")
              for (const part of nameParts) {
                if (part.includes('р-н')) {
                  district = part.replace('р-н', '').trim();
                  break;
                }
              }

              // For rural areas, we may have no street - use city name as street identifier
              if (!street && city) {
                street = city;
              }

              if (!houseNumber) continue;

              const normalizedRPP = normalizeHouseNumber(houseNumber);
              const streetId = normalizeStreetName(street);
              if (!streets[street]) {
                streets[street] = streetId;
                streetNames[streetId] = street;
              }

              features.push({
                number: normalizedRPP,
                street: streetId,
                streetRaw: street,
                houseNumberRaw: normalizedRPP,
                lat: lat,
                lon: lon,
                city: city,
                district: district
              });
            }

            resolve({ features, streets, streetNames });
          } catch (err) {
            reject(err);
          }
        },
        onerror: function (err) {
          reject(err);
        },
        ontimeout: function () {
          reject(new Error('Waze API timeout'));
        }
      });
    });
  }

  // Copy text to clipboard
  function copyToClipboard(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      toast(`Скопійовано: "${text}"`, 'success');
    } else {
      navigator.clipboard.writeText(text).then(() => {
        toast(`Скопійовано: "${text}"`, 'success');
      }).catch(() => {
        toast('Не вдалося скопіювати', 'error');
      });
    }
  }

  // Update selected segment's street name via WME SDK
  function updateSegmentStreetName(newStreetName, onSuccess) {
    const selectedSegments = getSelectedSegments();
    if (selectedSegments.length === 0) {
      toast('Не вибрано сегмент', 'warning');
      return;
    }

    const segment = selectedSegments[0];
    const segmentId = segment.id;

    const currentStreetId = segment.primaryStreetId;
    const currentStreet = currentStreetId ? wmeSDK.DataModel.Streets.getById({ streetId: currentStreetId }) : null;
    const cityId = currentStreet?.cityId;

    if (!cityId) {
      toast('Сегмент не має призначеного міста', 'warning');
      return;
    }

    try {
      let street = wmeSDK.DataModel.Streets.getStreet({
        cityId: cityId,
        streetName: newStreetName
      });

      if (!street) {
        console.debug('[UA-RPP] Вулицю не знайдено, створюємо нову:', newStreetName);
        street = wmeSDK.DataModel.Streets.addStreet({
          streetName: newStreetName,
          cityId: cityId
        });
      }

      console.debug('[UA-RPP] Знайдено вулицю:', street);

      wmeSDK.DataModel.Segments.updateAddress({
        segmentId: segmentId,
        primaryStreetId: street.id
      });

      console.debug('[UA-RPP] Оновлено сегмент', segmentId, 'на вулицю ID:', street.id);
      toast(`Оновлено назву вулиці на "${newStreetName}"`, 'success');

      if (typeof onSuccess === 'function') {
        onSuccess();
      }
    } catch (err) {
      console.error('[UA-RPP] Помилка оновлення назви вулиці:', err);
      toast('Помилка оновлення назви вулиці', 'error');
    }
  }

  function init() {
    let currentStreetId = null;
    let streetNames = {};
    let streets = {};
    let lastFeatures = [];
    let lastSdkFeatureIds = [];
    let isLoading = false;
    let currentLoadId = 0;
    let userWantsLayerVisible = false;
    let streetNameSpan = null;
    let currentStreetDiv = null;
    let streetAnalysisDiv = null;

    let chkMissing = null;
    let chkSelectedOnly = null;

    let applyFeatureFilter = () => {};
    let analyzeStreetMatches = () => {};

    try {
      I18n.translations[I18n.currentLocale()].layers.name['quick-rpp-ua-importer'] = 'Quick RPP Importer (UA)';
    } catch (_) {}

    wmeSDK.Map.addLayer({
      layerName: SDK_LAYER_NAME,
      zIndexing: true,
      styleContext: {
        getFillColor: ({ feature }) => {
          const p = feature.properties;
          if (p.conflict) return '#ff6666';
          return p.isSelectedStreet ? '#99ee99' : '#fb9c4f';
        },
        getOpacity: ({ feature }) => {
          const p = feature.properties;
          if (p.conflict) return 1;
          return (p.isSelectedStreet && p.processed) ? 0.3 : 1;
        },
        getRadius: ({ feature }) => {
          const num = feature.properties.number;
          return num ? Math.max(String(num).length * 7, 12) : 12;
        },
        getLabel: ({ feature }) => String(feature.properties.number ?? '')
      },
      styleRules: [{
        style: {
          graphicName: 'circle',
          pointRadius: '${getRadius}',
          fillColor: '${getFillColor}',
          fillOpacity: '${getOpacity}',
          strokeColor: '#ffffff',
          strokeWidth: 2,
          strokeOpacity: '${getOpacity}',
          label: '${getLabel}',
          fontColor: '#111111',
          fontWeight: 'bold',
          labelOutlineColor: '#ffffff',
          labelOutlineWidth: 0
        }
      }]
    });
    wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: false });

    let lastComputedVisibility = false;
    function updateLayerVisibility() {
      const currentZoom = wmeSDK.Map.getZoomLevel();
      const shouldBeVisible = userWantsLayerVisible && currentZoom >= 18;

      if (shouldBeVisible === lastComputedVisibility) return;
      lastComputedVisibility = shouldBeVisible;

      wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: shouldBeVisible });

      if (userWantsLayerVisible && !shouldBeVisible && lastFeatures.length > 0) {
        toast('Наблизьте до рівня 18+, щоб побачити номери будинків', 'info');
      }
    }

    wmeSDK.Events.on({ eventName: 'wme-map-zoom-changed', eventHandler: updateLayerVisibility });
    wmeSDK.Events.on({ eventName: 'wme-map-move-end', eventHandler: updateLayerVisibility });
    wmeSDK.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSelectionChanged });

    // Get all WME street names from selection (primary + alternate)
    function getWmeStreetNames() {
      const selectedSegments = getSelectedSegments();
      if (selectedSegments.length === 0) return [];

      const names = [];
      const seen = new Set();

      selectedSegments.forEach(seg => {
        // Primary
        if (seg.primaryStreetId) {
          const street = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
          if (street?.name && !seen.has(street.name.toLowerCase())) {
            names.push(street.name);
            seen.add(street.name.toLowerCase());
          }
        }
        // Alternate
        (seg.alternateStreetIds || []).forEach(id => {
          const street = wmeSDK.DataModel.Streets.getById({ streetId: id });
          if (street?.name && !seen.has(street.name.toLowerCase())) {
            names.push(street.name);
            seen.add(street.name.toLowerCase());
          }
        });
      });

      return names;
    }

    // Analyze street name matches and update UI
    analyzeStreetMatches = function() {
      if (!streetAnalysisDiv) return;
      if (!lastFeatures.length) {
        streetAnalysisDiv.style.display = 'none';
        return;
      }

      const wmeStreetNames = getWmeStreetNames();

      // Count addresses per official street name
      const streetCounts = {};
      lastFeatures.forEach(f => {
        const name = streetNames[f.street];
        if (!name) return;
        streetCounts[name] = (streetCounts[name] || 0) + 1;
      });

      // Sort by count descending
      const sorted = Object.entries(streetCounts)
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

      if (sorted.length === 0) {
        streetAnalysisDiv.style.display = 'none';
        return;
      }

      // Check how many match any WME street (primary or alternate)
      // Normalize all WME names for comparison
      const normalizedWmeNames = wmeStreetNames.map(n => normalizeForComparison(n));
      let matchCount = 0;
      if (wmeStreetNames.length > 0) {
        Object.entries(streetCounts).forEach(([name, count]) => {
          const normalized = normalizeForComparison(name);
          if (normalizedWmeNames.includes(normalized)) {
            matchCount += count;
          }
        });
      }
      const hasMismatch = wmeStreetNames.length > 0 && matchCount === 0 && sorted.length > 0;

      // Find fuzzy match if there's a mismatch
      let suggestedMatch = null;
      let suggestionSimilarity = 0;

      if (hasMismatch && wmeStreetNames.length > 0) {
        // Use first WME name for fuzzy matching
        const primaryWmeName = wmeStreetNames[0];
        for (const [name] of sorted) {
          const similarity = calculateSimilarity(primaryWmeName, name);
          if (similarity > 0.7 && similarity > suggestionSimilarity) {
            suggestedMatch = name;
            suggestionSimilarity = similarity;
          }
        }
      }

      // Build HTML
      let html = '';

      if (hasMismatch) {
        html += `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:8px;margin-bottom:8px;">`;
        html += `<b style="color:#856404;">⚠️ Не знайдено співпадінь!</b><br/>`;
        html += `<span style="font-size:11px;color:#856404;">Назва вулиці в WME не збігається з жодною офіційною назвою</span>`;
        html += `</div>`;

        if (suggestedMatch) {
          const escapedSuggested = escapeHtml(suggestedMatch);
          html += `<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:8px;margin-bottom:8px;">`;
          html += `<b style="color:#155724;">💡 Можливе співпадіння:</b><br/>`;
          html += `<div style="margin:4px 0;font-size:12px;">`;
          html += `<span style="color:#666;">WME:</span> <span style="color:#dc3545;text-decoration:line-through;">${escapeHtml(wmeStreetName)}</span><br/>`;
          html += `<span style="color:#666;">База:</span> <b style="color:#155724;">${escapedSuggested}</b>`;
          html += `</div>`;
          html += `<div style="display:flex;gap:6px;margin-top:6px;">`;
          html += `<button class="wz-button update-street-btn" data-street="${escapedSuggested}" style="font-size:11px;padding:2px 8px;">✓ Використати</button>`;
          html += `<button class="copy-street-btn" data-street="${escapedSuggested}" style="font-size:11px;padding:2px 8px;background:#f8f8f8;border:1px solid #ccc;border-radius:3px;cursor:pointer;">📋 Копія</button>`;
          html += `</div>`;
          html += `</div>`;
        }
      }

      html += `<div style="font-size:12px;margin-bottom:4px;"><b>Вулиці в районі:</b></div>`;
      html += `<div style="max-height:150px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;background:#fafafa;">`;

      sorted.forEach(([name, _count], index) => {
        const normalized = normalizeForComparison(name);
        const isMatch = normalizedWmeNames.includes(normalized);
        const isSuggestion = name === suggestedMatch;
        const escapedName = escapeHtml(name);

        let rowStyle = 'padding:4px 8px;font-size:11px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;';
        if (isMatch) rowStyle += 'background:#d4edda;';
        else if (isSuggestion) rowStyle += 'background:#fff3cd;';
        else if (index % 2 === 0) rowStyle += 'background:#f8f8f8;';

        html += `<div style="${rowStyle}">`;
        html += `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapedName}">`;
        if (isMatch) html += '✓ ';
        if (isSuggestion) html += '→ ';
        html += `${escapedName}</span>`;
        html += `<span style="margin-left:8px;white-space:nowrap;display:flex;align-items:center;gap:4px;">`;
        const btnStyle = isMatch
          ? 'padding:1px 4px;font-size:10px;cursor:default;border:1px solid #ccc;border-radius:2px;background:#e9e9e9;color:#999;'
          : 'padding:1px 4px;font-size:10px;cursor:pointer;border:1px solid #28a745;border-radius:2px;background:#d4edda;color:#155724;';
        html += `<button class="update-street-btn" data-street="${escapedName}" style="${btnStyle}" title="${isMatch ? 'Вже встановлено' : 'Використати'}">${isMatch ? '✓' : '→'}</button>`;
        html += `<button class="copy-street-btn" data-street="${escapedName}" style="padding:1px 4px;font-size:10px;cursor:pointer;border:1px solid #ccc;border-radius:2px;background:#fff;" title="Копіювати">📋</button>`;
        html += `</span>`;
        html += `</div>`;
      });

      html += `</div>`;
      html += `<div style="font-size:10px;color:#888;margin-top:4px;">→ = застосувати назву • 📋 = копіювати</div>`;

      streetAnalysisDiv.innerHTML = html;
      streetAnalysisDiv.style.display = 'block';

      // Add click handlers for copy buttons
      streetAnalysisDiv.querySelectorAll('.copy-street-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const streetName = btn.getAttribute('data-street');
          copyToClipboard(streetName);
        });
      });

      // Add click handlers for update buttons
      streetAnalysisDiv.querySelectorAll('.update-street-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const streetName = btn.getAttribute('data-street');

          const currentWmeStreets = getWmeStreetNames();
          if (currentWmeStreets.includes(streetName)) {
            toast('Назва вулиці вже встановлена', 'info');
            return;
          }

          updateSegmentStreetName(streetName, () => {
            const newStreetId = streets[streetName];
            if (newStreetId) {
              currentStreetId = newStreetId;

              if (streetNameSpan && currentStreetDiv) {
                streetNameSpan.textContent = streetName;
                currentStreetDiv.style.display = 'block';
              }
            }

            setTimeout(() => {
              analyzeStreetMatches();
              applyFeatureFilter();
            }, 100);
          });
        });
      });
    };

    function onSelectionChanged() {
      if (!lastFeatures.length) return;

      const selectedSegments = getSelectedSegments();
      if (selectedSegments.length === 0) {
        return;
      }

      const selectedStreetIds = new Set();

      selectedSegments.forEach(seg => {
        const psid = seg.primaryStreetId;
        if (psid && psid > 0) selectedStreetIds.add(psid);
        (seg.alternateStreetIds || []).forEach(id => {
          if (id && id > 0) selectedStreetIds.add(id);
        });
      });

      if (selectedStreetIds.size === 0) {
        currentStreetId = null;
        if (streetNameSpan && currentStreetDiv) {
          streetNameSpan.textContent = '—';
          currentStreetDiv.style.display = 'none';
        }
        applyFeatureFilter();
        analyzeStreetMatches();
        return;
      }

      const selectedStreetNames = Array.from(selectedStreetIds)
        .map(id => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name)
        .filter(Boolean);

      let newStreetId = null;
      let bestCount = -1;

      selectedStreetNames.forEach(name => {
        const sid = streets[name];
        if (!sid) return;
        const count = lastFeatures.reduce(
          (n, f) => n + (f.street === sid ? 1 : 0),
          0
        );
        if (count > bestCount) {
          bestCount = count;
          newStreetId = sid;
        }
      });

      if (!newStreetId) {
        currentStreetId = null;
        if (streetNameSpan && currentStreetDiv) {
          streetNameSpan.textContent = '—';
          currentStreetDiv.style.display = 'none';
        }
        applyFeatureFilter();
        analyzeStreetMatches();
        return;
      }

      currentStreetId = newStreetId;

      if (streetNameSpan && currentStreetDiv && streetNames[currentStreetId]) {
        streetNameSpan.textContent = streetNames[currentStreetId];
        currentStreetDiv.style.display = 'block';
      }

      applyFeatureFilter();
      analyzeStreetMatches();
    }

    function handleMapClick(evt) {
      console.log('[UA-RPP] handleMapClick', { hasFeatures: !!lastFeatures.length, evt });
      if (!lastFeatures.length) return;
      
      // Support both coordinate formats
      const x = evt.x ?? evt.clientX ?? evt.layerX;
      const y = evt.y ?? evt.clientY ?? evt.layerY;
      if (x == null || y == null) return;

      const MAX_PIXELS_SQ = MAX_CLICK_DISTANCE_PX * MAX_CLICK_DISTANCE_PX;
      let bestFeature = null;
      let bestDistSq = Infinity;

      for (const f of lastFeatures) {
        console.log('[UA-RPP] Checking feature', { lon: f.lon, lat: f.lat, number: f.number });
        if (f.lon == null || f.lat == null || isNaN(f.lon) || isNaN(f.lat)) continue;
        const fPx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: f.lon, lat: f.lat } });
        if (!fPx) continue;
        const dx = fPx.x - x;
        const dy = fPx.y - y;
        const d2 = dx * dx + dy * dy;
        console.log('[UA-RPP] Dist check', { number: f.number, d2, max: MAX_PIXELS_SQ });
        if (d2 <= MAX_PIXELS_SQ && d2 < bestDistSq) {
          bestDistSq = d2;
          bestFeature = f;
        }
      }

      console.log('[UA-RPP] Best feature', { bestFeature: bestFeature?.number });
      if (!bestFeature) return;
      onFeatureClick(bestFeature);
    }

    wmeSDK.Events.on({ eventName: 'wme-map-mouse-click', eventHandler: handleMapClick });

    function onFeatureClick(feature) {
      console.log('[UA-RPP] onFeatureClick', { processed: feature.processed, number: feature.number, lat: feature.lat, lon: feature.lon });
      if (feature.processed) return;
      if (typeof feature.lat !== 'number' || typeof feature.lon !== 'number' || isNaN(feature.lat) || isNaN(feature.lon)) {
        console.warn('[UA-RPP] Invalid coordinates for feature:', feature);
        return;
      }

      const houseNumber = normalizeHouseNumber(feature.number);
      const featureLon = feature.lon;
      const featureLat = feature.lat;

      try {
        // Find the nearest segment to get the street
        const segments = wmeSDK.DataModel.Segments.getAll();
        console.log('[UA-RPP] Total segments:', segments.length);
        
        let nearestStreetId = null;
        let minDist = Infinity;
        
        // Calculate distance to segment
        function pointToSegmentDist(px, py, x1, y1, x2, y2) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          if (dx === 0 && dy === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
          }
          const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
          const closestX = x1 + t * dx;
          const closestY = y1 + t * dy;
          return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
        }
        
// Convert feature coords to pixel coords
        const featurePx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: featureLon, lat: featureLat } });

        for (const seg of segments) {
          const coords = seg.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;
          
          // Calculate distance to each segment line
          for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            if (!p1 || !p2) continue;
            
            const p1Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p1[0], lat: p1[1] } });
            const p2Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p2[0], lat: p2[1] } });
            
            const dist = pointToSegmentDist(featurePx.x, featurePx.y, p1Px.x, p1Px.y, p2Px.x, p2Px.y);
            if (dist < minDist) { // увеличен порог до 300px
              minDist = dist;
              nearestStreetId = seg.primaryStreetId;
            }
          }
        }
        
        if (!nearestStreetId) {
          console.warn('[UA-RPP] Не знайдено сегментів. Мінімальна відстань:', minDist, 'px');
          throw new Error('Не знайдено сегментів поруч з цим маркером');
        }
        
        // Check if street has a name (RPP cannot be created without street name)
        const street = wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId });
        if (!street || !street.name) {
          throw new Error('Сегмент без назви вулиці — RPP не можна створити');
        }
        
        const streetId = nearestStreetId;
        console.log('[UA-RPP] Nearest segment street ID:', streetId, 'distance:', minDist, 'px');

        const geometry = {
          type: 'Point',
          coordinates: [feature.lon, feature.lat]
        };

        // Add venue
        const venueId = wmeSDK.DataModel.Venues.addVenue({
          category: 'OTHER',
          geometry: geometry
        });

        // Update with address and street
        wmeSDK.DataModel.Venues.updateVenue({
          venueId: String(venueId),
          name: houseNumber
        });
        
        wmeSDK.DataModel.Venues.updateAddress({
          venueId: String(venueId),
          houseNumber: houseNumber,
          streetId: streetId
        });

        // Set as residential
        wmeSDK.DataModel.Venues.updateVenueIsResidential({
          venueId: String(venueId),
          isResidential: true
        });

        // Add entry point for navigation
        wmeSDK.DataModel.Venues.replaceNavigationPoints({
          venueId: String(venueId),
          navigationPoints: [{
            isEntry: true,
            isExit: true,
            isPrimary: true,
            name: '',
            point: { type: 'Point', coordinates: [feature.lon, feature.lat] }
          }]
        });

        // Select the new venue to open edit panel
        wmeSDK.Editing.setSelection({
          selection: {
            ids: [String(venueId)],
            objectType: 'venue'
          }
        });

        console.log('[UA-RPP] RPP created:', { venueId, streetId, houseNumber });

        feature.userAdded = true;
        feature.processed = true;
        feature.conflict = false;
        applyFeatureFilter();

        console.log('[UA-RPP] Додано RPP', houseNumber);
        toast(`Додано RPP ${houseNumber} 🏠`, 'success');
      } catch (err) {
        console.error('[UA-RPP] Помилка додавання RPP:', err);
        toast(err.message || 'Помилка додавання RPP', 'error');
      }
    }

    const loading = document.createElement('div');
    loading.style.position = 'absolute';
    loading.style.bottom = '35px';
    loading.style.width = '100%';
    loading.style.pointerEvents = 'none';
    loading.style.display = 'none';
    loading.innerHTML =
      '<div style="margin:0 auto; max-width:300px; text-align:center; background:rgba(0, 0, 0, 0.5); color:white; border-radius:3px; padding:5px 15px;"><i class="fa fa-pulse fa-spinner"></i> Завантаження адрес...</div>';
    document.getElementById('map').appendChild(loading);

    wmeSDK.Sidebar.registerScriptTab().then(({ tabLabel, tabPane }) => {
      tabLabel.innerText = 'UA-RPP';
      tabLabel.title = 'Швидкий імпорт номерів (Україна)';

      tabPane.innerHTML = `
        <div id="qhnua-pane" style="padding:10px;">
          <h2 style="margin-top:0;">Швидкий імпорт <span style="background:linear-gradient(to bottom,#005BBB 0 50%,#FFD500 50% 100%);background-size:16px 16px;height:16px;width:16px;display:inline-block;vertical-align:middle;margin-left:4px;border:1px solid #ccc;"></span></h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px 0;">
            <button id="hn-load" class="wz-button"><span id="hn-load-label">Завантажити</span> <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+L</kbd></button>
            <button id="hn-clear" class="wz-button wz-button--secondary">Очистити <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+K</kbd></button>
          </div>
          <div id="hn-current-street" style="margin:8px 0;padding:8px;background:#f0f0f0;border-radius:4px;font-size:13px;display:none;">
            <b>Вибрана вулиця WME:</b> <span id="hn-street-name" style="color:#2a7;font-weight:bold;">—</span>
          </div>
          <div id="hn-street-analysis" style="margin:8px 0;display:none;"></div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <wz-checkbox id="hn-toggle">Показати точки</wz-checkbox>
            <wz-checkbox id="qhnua-missing">Тільки відсутні</wz-checkbox>
            <wz-checkbox id="qhnua-selected-only">Тільки обрані</wz-checkbox>
            <span style="font-size:12px;">Радіус (м): <input id="qhnua-buffer" type="number" min="0" step="50" style="width:80px;margin-left:6px"></span>
          </div>
          <div style="margin:6px 0;font-size:13px;">
            <span style="color:#0066cc;font-weight:bold;">Джерело: Держреєстр (stat.waze.com.ua)</span>
          </div>
          <div id="hn-status" style="margin-top:10px;font-size:12px;color:#666;line-height:1.4;">
            <b>Інструкція</b><br/>
            1) Вибрати сегмент • 2) Натиснути "Завантажити" • 3) <b>Клікнути номер на карті для додавання</b>
          </div>
        </div>
      `;

      const btnLoad      = tabPane.querySelector('#hn-load');
      const btnLoadLabel = tabPane.querySelector('#hn-load-label');
      const btnClear     = tabPane.querySelector('#hn-clear');
      const chkVis = tabPane.querySelector('#hn-toggle');
      chkMissing = tabPane.querySelector('#qhnua-missing');
      chkSelectedOnly = tabPane.querySelector('#qhnua-selected-only');
      const bufferEl   = tabPane.querySelector('#qhnua-buffer');
      const statusDiv  = tabPane.querySelector('#hn-status');

      currentStreetDiv = tabPane.querySelector('#hn-current-street');
      streetNameSpan = tabPane.querySelector('#hn-street-name');
      streetAnalysisDiv = tabPane.querySelector('#hn-street-analysis');

      const isChecked  = (el) => el?.hasAttribute('checked');
      const setChecked = (el, v) => { if (el) v ? el.setAttribute('checked', '') : el.removeAttribute('checked'); };
      const safeSetChecked = (id, v) => { const el = tabPane.querySelector(id); if (el) v ? el.setAttribute('checked', '') : el.removeAttribute('checked'); };

      bufferEl.value = String(LS.getBuffer());
      if (LS.getLayerVisible()) {
        setChecked(chkVis, true);
        userWantsLayerVisible = true;
        updateLayerVisibility();
      }
      setChecked(chkSelectedOnly, LS.getSelectedOnly() ? true : false);

      bufferEl.addEventListener('change', () => {
        const val = Number(bufferEl.value);
        if (!Number.isFinite(val) || val < 0) {
          bufferEl.value = String(LS.getBuffer());
          return;
        }
        LS.setBuffer(val);
      });

      chkVis.addEventListener('click', () => {
        const on = isChecked(chkVis);
        setChecked(chkVis, !on);
        userWantsLayerVisible = !on;
        LS.setLayerVisible(!on);
        updateLayerVisibility();
      });

      chkMissing?.addEventListener('click', () => {
        setChecked(chkMissing, !isChecked(chkMissing));
        applyFeatureFilter();
      });

      chkSelectedOnly?.addEventListener('click', () => {
        const newState = !isChecked(chkSelectedOnly);
        setChecked(chkSelectedOnly, newState);
        LS.setSelectedOnly(newState);
        applyFeatureFilter();
      });

      async function loadSelectedStreet() {
        if (isLoading) return;
        isLoading = true;
        const myLoadId = ++currentLoadId;
        btnLoad.disabled = true;
        btnLoadLabel.textContent = 'Завантаження…';

        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
          lastSdkFeatureIds = [];
        }
        streets = {};
        streetNames = {};
        currentStreetId = null;
        lastFeatures = [];
        streetAnalysisDiv.style.display = 'none';

        await updateLayer(statusDiv, myLoadId).catch(err => console.warn('UA-RPP updateLayer:', err));

        // Skip post-load side effects if user clicked Clear (or started another Load) mid-fetch
        if (myLoadId === currentLoadId) {
          userWantsLayerVisible = true;
          setChecked(chkVis, true);
          LS.setLayerVisible(true);
          updateLayerVisibility();
        }

        btnLoad.disabled = false;
        btnLoadLabel.textContent = 'Завантажити';
        isLoading = false;
      }

      btnLoad.addEventListener('click', loadSelectedStreet);

      function clearLayer() {
        currentLoadId++; // invalidate any in-flight load so its results are discarded
        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
          lastSdkFeatureIds = [];
        }
        // Clear deduplication cache so reloading shows all addresses
        window.__uaRppSeenFeatures?.clear();
        userWantsLayerVisible = false;
        wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: false });
        setChecked(chkVis, false);
        LS.setLayerVisible(false);
        streets = {};
        streetNames = {};
        currentStreetId = null;
        lastFeatures = [];
        currentStreetDiv.style.display = 'none';
        streetAnalysisDiv.style.display = 'none';
        statusDiv.innerHTML = `<b>Інструкція</b><br/>
          1) Вибрати сегмент • 2) Натиснути "Завантажити" • 3) <b>Клікнути номер на карті для додавання</b>`;
      }

      btnClear.addEventListener('click', clearLayer);

      applyFeatureFilter = function () {
        console.log('[UA-RPP] applyFeatureFilter', { lastFeaturesCount: lastFeatures.length });
        const onlyMissing  = chkMissing?.hasAttribute('checked');
        const visible = lastFeatures.filter(feat => {
          if (onlyMissing && feat.processed) return false;
          // Фильтр невалидных координат
          if (typeof feat.lat !== 'number' || typeof feat.lon !== 'number' || isNaN(feat.lat) || isNaN(feat.lon)) return false;
          return true;
        });
        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
        }
        const visibleSdk = visible.map((feat, i) => ({
          type: 'Feature',
          id: `qhnua-${i}`,
          geometry: { type: 'Point', coordinates: [feat.lon, feat.lat] },
          properties: {
            number: feat.number,
            street: feat.street,
            processed: feat.processed,
            conflict: feat.conflict,
            isSelectedStreet: feat.street === currentStreetId
          }
        }));
        wmeSDK.Map.addFeaturesToLayer({ layerName: SDK_LAYER_NAME, features: visibleSdk });
        lastSdkFeatureIds = visibleSdk.map(f => f.id);
      };

      async function recalculateFeatureStates() {
        if (!lastFeatures.length) return;

        const selectionRPPMap = await getVisibleRPPsByStreet();

        lastFeatures.forEach(feat => {
          const { number: hn, street: streetId, lon, lat } = feat;
          if (!hn || !streetId) return;

          const entry = selectionRPPMap.get(streetId);
          const processed = (entry?.set.has(hn) === true) || feat.userAdded === true;
          const conflict = !processed && hasConflict(hn, lon, lat, entry);

          feat.processed = processed;
          feat.conflict = conflict;
        });

        applyFeatureFilter();
      }

      function setupHouseNumberEventListeners() {
        const events = [
          'wme-house-number-added',
          'wme-house-number-deleted',
          'wme-house-number-moved',
          'wme-house-number-updated'
        ];

        events.forEach(eventName => {
          wmeSDK.Events.on({
            eventName,
            eventHandler: () => {
              if (lastFeatures.length > 0) {
                recalculateFeatureStates().catch(err => console.warn('[UA-RPP] recalculate failed:', err));
              }
            }
          });
        });

        wmeSDK.Events.on({
          eventName: 'wme-map-data-loaded',
          eventHandler: () => {
            if (lastFeatures.length > 0) {
              recalculateFeatureStates().catch(err => console.warn('[UA-RPP] recalculate failed:', err));
            }
          }
        });

        // Listen for segment edits (like street name changes) to refresh UI
        wmeSDK.Events.on({
          eventName: 'wme-after-edit',
          eventHandler: () => {
            if (lastFeatures.length > 0) {
              analyzeStreetMatches();
              applyFeatureFilter();
            }
          }
        });
      }

      setupHouseNumberEventListeners();

      // Register keyboard shortcuts
      ['qhnua-load', 'qhnua-clear'].forEach(id => {
        try { wmeSDK.Shortcuts.deleteShortcut({ shortcutId: id }); } catch (_) {}
      });
      [
        { shortcutId: 'qhnua-load',  shortcutKeys: 'AS+l', description: 'UA-RPP: Завантажити', callback: loadSelectedStreet },
        { shortcutId: 'qhnua-clear', shortcutKeys: 'AS+k', description: 'UA-RPP: Очистити',                callback: clearLayer }
      ].forEach(spec => {
        try { wmeSDK.Shortcuts.createShortcut(spec); }
        catch (e) { console.warn('UA-RPP: не вдалося зареєструвати хоткей', spec.shortcutId, e); }
      });

      function updateLayer(statusDiv, loadId) {
        return new Promise((resolve) => {
          const selectedSegments = getSelectedSegments();
          if (selectedSegments.length === 0) {
            toast('Спочатку виберіть сегмент.', 'warning');
            statusDiv.textContent = 'Не вибрано сегмент.';
            resolve();
            return;
          }

          loading.style.display = null;

          // Get city from selected segment
          const segment = selectedSegments[0];
          const street = segment.primaryStreetId ? wmeSDK.DataModel.Streets.getById({ streetId: segment.primaryStreetId }) : null;
          const cityId = street?.cityId;
          const city = cityId ? wmeSDK.DataModel.Cities.getById({ cityId })?.name : null;
          console.log('[UA-RPP] Selected city:', city, 'cityId:', cityId);

          // Compute bounding box of selected segments to get center
          let minLon = Infinity, maxLon = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;
          selectedSegments.forEach(seg => {
            const coords = seg.geometry?.coordinates;
            if (!Array.isArray(coords)) return;
            coords.forEach(pt => {
              const lon = pt[0], lat = pt[1];
              if (lon < minLon) minLon = lon;
              if (lon > maxLon) maxLon = lon;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            });
          });

          if (minLon === Infinity) {
            loading.style.display = 'none';
            statusDiv.textContent = 'Немає геометрії для вибраного сегмента.';
            resolve();
            return;
          }

          // Calculate center of bbox
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          const zoom = wmeSDK.Map.getZoomLevel();
          // Radius based on zoom (same as UA-address-data script)
          let radius = 400;
          if (zoom === 16) radius = 1000;
          else if (zoom === 17) radius = 600;
          const userBuffer = LS.getBuffer();
          radius = Math.max(radius, userBuffer);

          Promise.all([
            fetchAddressesWaze(centerLat, centerLon, radius),
            getVisibleRPPsByStreet()
          ])
            .then(([apiResult, selectionRPPMap]) => {
              // Bail out if user clicked Clear (or started a newer load) while the fetch was in flight
              if (loadId !== currentLoadId) {
                loading.style.display = 'none';
                resolve();
                return;
              }

              const { features: apiFeatures, streets: newStreets, streetNames: newStreetNames } = apiResult;
              console.log('[UA-RPP] API returned', apiFeatures.length, 'features');
              streets = newStreets;
              streetNames = newStreetNames;

              // Persistent deduplication Set (survives between updateLayer calls)
              // Key: normalized number + rounded coordinates (to filter duplicates at same location)
              if (!window.__uaRppSeenFeatures) window.__uaRppSeenFeatures = new Set();
              const seenFeatures = window.__uaRppSeenFeatures;

              const features = [];
              for (const item of apiFeatures) {
                if (!item.lat || !item.lon) continue;

// TODO: Filter by city using coordinates (nearest city lookup via kadastrova-karta API)

                const entry = selectionRPPMap.get(item.street);
                const normalizedNum = normalizeHouseNumber(item.number);
                const processed = entry?.set.has(normalizedNum) === true;
                const conflict = !processed && hasConflict(normalizedNum, item.lon, item.lat, entry);

                // Create unique key: number + street only (same address cannot appear twice on one street)
                // Deduplication persists across reloads until Clear is clicked
                const featureKey = `${normalizedNum}|${item.street}`;
                if (seenFeatures.has(featureKey)) continue;
                seenFeatures.add(featureKey);

                features.push({
                  number: normalizedNum,
                  street: item.street,
                  processed,
                  conflict,
                  lon: item.lon,
                  lat: item.lat
                });
              }

              const allStreetIds = new Set();
              selectedSegments.forEach(seg => {
                (seg.alternateStreetIds || []).forEach(id => allStreetIds.add(id));
                if (seg.primaryStreetId) allStreetIds.add(seg.primaryStreetId);
              });
              const selectedNames = [...allStreetIds]
                .map(id => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name)
                .filter(Boolean);

              let best = null, bestCount = -1;
              selectedNames.forEach(name => {
                const sid = streets[name];
                if (!sid) return;
                const count = features.reduce((n,f)=> n + (f.street === sid ? 1 : 0), 0);
                if (count > bestCount) { best = sid; bestCount = count; }
              });

              currentStreetId = best || null;

              if (!features.length) {
                loading.style.display = 'none';
                statusDiv.textContent = 'Не знайдено адрес у цьому районі.';
                resolve();
                return;
              }

              lastFeatures = features;

              if (currentStreetId && streetNames[currentStreetId]) {
                streetNameSpan.textContent = streetNames[currentStreetId];
                currentStreetDiv.style.display = 'block';
              } else {
                currentStreetDiv.style.display = 'none';
              }

              if (lastSdkFeatureIds.length) {
                wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
                lastSdkFeatureIds = [];
              }

              applyFeatureFilter();
              analyzeStreetMatches();

              // Ensure layer is visible after load
              lastComputedVisibility = true; // Force visibility state
              wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: true });
              userWantsLayerVisible = true;
              setChecked(chkVis, true);
              LS.setLayerVisible(true);

              loading.style.display = 'none';
              const processedCount = features.filter(f => f.processed).length;
              statusDiv.innerHTML = `Завантажено ${features.length} адрес.<br/>` +
                `<b>Клікніть на номер на карті, щоб додати!</b><br/>` +
                `<span style="font-size:11px;color:#666;">` +
                `${processedCount} вже в WME` +
                `</span>`;
              resolve();
            })
            .catch(err => {
              console.error('[UA-RPP] Помилка API:', err);
              loading.style.display = 'none';
              if (loadId === currentLoadId) {
                statusDiv.textContent = 'Помилка отримання даних. Перевірте консоль.';
                toast('Помилка отримання даних адрес.', 'error');
              }
              resolve();
            });
        });
      }

      // Visible RPPs grouped by normalized street name (primary + alternate)
      async function getVisibleRPPsByStreet() {
        const map = new Map();
        const ext = wmeSDK.Map.getMapExtent();
        const [lonMin, latMin, lonMax, latMax] = Array.isArray(ext)
          ? ext
          : [ext.lonMin, ext.latMin, ext.lonMax, ext.latMax];

        const segIds = wmeSDK.DataModel.Segments.getAll()
          .filter(s => s.hasHouseNumbers)
          .map(s => s.id);
        const allHns = segIds.length
          ? await wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: segIds })
          : [];

        allHns.forEach(hn => {
          const seg = wmeSDK.DataModel.Segments.getById({ segmentId: hn.segmentId });
          if (!seg) return;

          const streetIdSet = new Set();
          if (seg.primaryStreetId) {
            streetIdSet.add(seg.primaryStreetId);
          }
          (seg.alternateStreetIds || []).forEach(id => {
            if (id) streetIdSet.add(id);
          });
          if (!streetIdSet.size) return;

          const g = getRPGeometry(hn);
          let x, y;
          if (g && typeof g.x === 'number' && typeof g.y === 'number') {
            x = g.x;
            y = g.y;
          }
          if (x == null || y == null || x < lonMin || x > lonMax || y < latMin || y > latMax) return;

          const numRaw = String(hn.number).trim();

          streetIdSet.forEach(streetId => {
            const st = wmeSDK.DataModel.Streets.getById({ streetId });
            const name = st?.name;
            if (!name) return;

            const sidNorm = normalizeStreetName(name);

            let entry = map.get(sidNorm);
            if (!entry) {
              entry = { set: new Set(), items: [] };
              map.set(sidNorm, entry);
            }

            entry.set.add(numRaw);
            entry.items.push({ num: numRaw, x, y });
          });
        });

        return map;
      }
    });
  }

  (unsafeWindow || window).SDK_INITIALIZED.then(() => {
    wmeSDK = getWmeSdk({ scriptId: 'quick-rpp-ua-importer', scriptName: 'Quick RPP Importer (UA)' });
    wmeSDK.Events.once({ eventName: 'wme-ready' }).then(() => {
      const required = [
        'Map.addLayer',
        'Map.addFeaturesToLayer',
        'Map.removeFeaturesFromLayer',
        'Map.setLayerVisibility',
        'Map.getZoomLevel',
        'Map.getMapExtent',
        'Map.getMapPixelFromLonLat',
        'DataModel.Venues.addVenue',
        'DataModel.Venues.updateVenue',
        'DataModel.Venues.updateAddress',
        'DataModel.Venues.updateVenueIsResidential',
        'DataModel.Venues.replaceNavigationPoints',
        'DataModel.Venues.getAddress',
        'DataModel.Streets.getStreet',
        'DataModel.Streets.getById',
        'Editing.setSelection'
      ];
      const missing = required.filter(path => {
        const parts = path.split('.');
        let cur = wmeSDK;
        for (const part of parts) { cur = cur?.[part]; if (cur == null) return true; }
        return false;
      });
      if (missing.length) {
        console.error('[UA-RPP] WME SDK відсутні необхідні API:', missing);
        toast(`UA-RPP: WME SDK не має ${missing.length} необхідних API. Див. консоль.`, 'error');
        return;
      }
      init();
    });
  });
})();