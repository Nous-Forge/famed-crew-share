# F.A.M-E.D. schema v1 wire contract

Frozen at 2026-10-28T23:45:47.081638-07:00. This is the actual preparation date. The planned Thursday date was not copied into the freeze status.

I use CSV `Name` exclusively as the DataTable row key. The internal JSON key is `RowName`. Display text uses the distinct property `CardName`. The future struct has no property named `Name`. This removes the key/property collision by construction. The root lead approved this technical choice under the owner's overnight delegation.

All fields and their order come from FAMED_CardRow.contract.json. `SupplyCopies` uses int32; other wire properties use FString. EffectTags and Unmapped use JSON arrays inside properly quoted CSV cells. PileAfterUse is a validated string enum with exact wire spellings `Discard Pile`, `Removed-From-Deck pile`, `UNSET`. A future C++ enum adapter must map those strings explicitly. Rev4b section6.1 supplies the two named after-use piles; source soft hyphens are normalized to ASCII hyphens in the wire spelling. The contract preserves raw source text independently. Hand, deck and character sheet are not added as invented after-use piles. Unsupported destinations remain UNSET with a finding. PileText preserves printed exceptions and R.F.D. references.

The enum choices and field mapping pass static source checks. No Unreal import, generated C++ struct, Unreal build or browser engine test was performed. Import-ready by contract, not yet import-tested in Unreal.

Eight literal icon tags have supported meanings. Five template variables remain UNRESOLVED_BINDING. Formatting markup is not gameplay semantics. No positional tag matching occurs.

The contract freeze does not release a card pack. The website source is not captured in this offline package. A conflict requiring that higher-ranked source must stop for review. The corpus authority ranks and primary source hashes remain explicit.

© 2026 Piero L. S. Folly | Khi-Rho Studios | Copy GDD-HO-0E446BDDA5 | All rights reserved.
