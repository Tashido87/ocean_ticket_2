import assert from 'node:assert/strict';
import {
    calculateCheckDigit,
    cleanNameCandidate,
    formatMrzDate,
    mergePassportOcr,
    normalizeNationality,
    validatePassportNo
} from '../passport-parser.mjs';

const REFERENCE_DATE = new Date('2026-05-17T00:00:00+06:30');

function makeLine1(name) {
    return `PVMMR${name.replace(/\s+/g, '<')}`.padEnd(44, '<').slice(0, 44);
}

function makeLine2(passportNo, dob, sex, expiry) {
    const passportField = `${passportNo}<`;
    return `${passportField}${calculateCheckDigit(passportField)}MMR${dob}${calculateCheckDigit(dob)}${sex}${expiry}${calculateCheckDigit(expiry)}`
        .padEnd(44, '<')
        .slice(0, 44);
}

function parseFromMrz(line1, line2) {
    return mergePassportOcr({
        mrzText: `${line1}\n${line2}`,
        referenceDate: REFERENCE_DATE
    });
}

function assertPassport(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
        assert.equal(actual[key], value, `${key} should be ${value}`);
    }
    assert.equal(actual.nationality, 'MMR');
    assert.equal(actual.validations.passportValid, true);
    assert.equal(actual.validations.dobValid, true);
    assert.equal(actual.validations.expiryValid, true);
    assert.equal(actual.validations.mrzStructureValid, true);
}

assert.equal(formatMrzDate('000517', true, REFERENCE_DATE), '05/17/2000');
assert.equal(formatMrzDate('580114', true, REFERENCE_DATE), '01/14/1958');
assert.equal(formatMrzDate('131118', true, REFERENCE_DATE), '11/18/2013');
assert.equal(formatMrzDate('970211', true, REFERENCE_DATE), '02/11/1997');
assert.equal(formatMrzDate('221227', true, REFERENCE_DATE), '12/27/2022');

assertPassport(
    parseFromMrz(makeLine1('KYIN YEE'), makeLine2('MJ091278', '580114', 'F', '290529')),
    {
        fullName: 'KYIN YEE',
        passportNo: 'MJ091278',
        dob: '01/14/1958',
        expiry: '05/29/2029',
        sex: 'F',
        title: 'MS'
    }
);

assertPassport(
    parseFromMrz(
        'PVMMRYE<MIN<KHANT<<<<<<<<<<<<<<<<<<<<<<<<',
        'MF971828<6MMR0005175M2705309<<<<<<<<<<<<4'
    ),
    {
        fullName: 'YE MIN KHANT',
        passportNo: 'MF971828',
        dob: '05/17/2000',
        expiry: '05/30/2027',
        sex: 'M',
        title: 'MR'
    }
);

assertPassport(
    parseFromMrz(makeLine1('MOE MOE'), makeLine2('MK412423', '131118', 'F', '300924')),
    {
        fullName: 'MOE MOE',
        passportNo: 'MK412423',
        dob: '11/18/2013',
        expiry: '09/24/2030',
        sex: 'F',
        title: 'MS'
    }
);

assertPassport(
    parseFromMrz(makeLine1('SUTT NAW AUNG'), makeLine2('MG336792', '970211', 'M', '270821')),
    {
        fullName: 'SUTT NAW AUNG',
        passportNo: 'MG336792',
        dob: '02/11/1997',
        expiry: '08/21/2027',
        sex: 'M',
        title: 'MR'
    }
);

assertPassport(
    parseFromMrz(
        'PVMMRSWAN<PHONE<MYAT<OO<<<<<<<<<<<<<<<<<',
        'MH649431<4MMR2212278M2806295<<<<<<<<<<<<8'
    ),
    {
        fullName: 'SWAN PHONE MYAT OO',
        passportNo: 'MH649431',
        dob: '12/27/2022',
        expiry: '06/29/2028',
        sex: 'M',
        title: 'MSTR'
    }
);

assert.equal(validatePassportNo('MAQPA2VBC'), false);
assert.equal(validatePassportNo('SLTSNRRLJ'), false);
assert.equal(validatePassportNo('124238MM'), false);
assert.equal(normalizeNationality('I3I'), '');
assert.equal(normalizeNationality('TET'), '');
assert.equal(cleanNameCandidate('KYIN CYEE C C CCCL CLCLLLLLLLLLLLLK'), '');
assert.equal(cleanNameCandidate('YE CX MIN SKHANTC C CCCLLLLLLLLLLLLCL'), '');
assert.equal(cleanNameCandidate('MOE MOE SCHUPREXLCLLCRERCXCSNCE'), '');
assert.equal(cleanNameCandidate('YGSRNPRLAYUSYTTRNRANBLIAJ NTXASNT4 2'), '');
assert.equal(cleanNameCandidate('A'.repeat(41)), '');

const badVisual = mergePassportOcr({
    visualText: `
        Passport No MAQPA2VBC
        Nationality I3I
        Name KYIN CYEE C C CCCL CLCLLLLLLLLLLLLK
    `,
    referenceDate: REFERENCE_DATE
});
assert.equal(badVisual.passportNo, '');
assert.equal(badVisual.fullName, '');
assert.equal(badVisual.nationality, '');

console.log('passport-parser tests passed');
