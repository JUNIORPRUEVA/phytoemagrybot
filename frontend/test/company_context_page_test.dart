import 'package:dashboard_pwa/pages/company_context_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService() : super(baseUrl: 'https://example.com');

  String? savedCompanyName;
  String? savedGoogleMapsLink;
  Map<String, dynamic>? savedWorkingHours;
  Map<String, dynamic>? savedUsageRules;

  @override
  Future<CompanyContextData> getCompanyContext() async {
    return const CompanyContextData(
      id: 1,
      companyName: 'Phyto Emagry',
      description: 'Suplementos y orientacion comercial.',
      phone: '809-555-1234',
      whatsapp: '+18095551234',
      address: 'Santo Domingo',
      latitude: 18.486058,
      longitude: -69.931212,
      googleMapsLink: 'https://www.google.com/maps?q=18.486058,-69.931212',
      workingHoursJson: <String, dynamic>{
        'lunes_viernes': '8:00 AM - 6:00 PM',
      },
      bankAccountsJson: <CompanyBankAccountData>[
        CompanyBankAccountData(
          bank: 'Banreservas',
          accountType: 'Ahorro',
          number: '123456789',
          holder: 'Empresa Demo',
          image: '',
        ),
      ],
      imagesJson: <CompanyImageData>[
        CompanyImageData(url: 'https://example.com/company.jpg'),
      ],
      usageRulesJson: <String, dynamic>{
        'send_location': 'solo_si_cliente_la_pide',
      },
    );
  }

  @override
  Future<CompanyContextData> saveCompanyContext({
    required String companyName,
    required String description,
    required String phone,
    required String whatsapp,
    required String address,
    required String googleMapsLink,
    required double? latitude,
    required double? longitude,
    required Map<String, dynamic> workingHoursJson,
    required List<Map<String, dynamic>> bankAccountsJson,
    required List<Map<String, dynamic>> imagesJson,
    required Map<String, dynamic> usageRulesJson,
  }) async {
    savedCompanyName = companyName;
    savedGoogleMapsLink = googleMapsLink;
    savedWorkingHours = workingHoursJson;
    savedUsageRules = usageRulesJson;

    return CompanyContextData(
      id: 1,
      companyName: companyName,
      description: description,
      phone: phone,
      whatsapp: whatsapp,
      address: address,
      latitude: latitude,
      longitude: longitude,
        googleMapsLink: googleMapsLink,
      workingHoursJson: workingHoursJson,
      bankAccountsJson: bankAccountsJson
          .map(CompanyBankAccountData.fromJson)
          .toList(),
      imagesJson: imagesJson.map(CompanyImageData.fromJson).toList(),
      usageRulesJson: usageRulesJson,
    );
  }
}

void main() {
  testWidgets('company context page loads and saves structured business data', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 1200));
    final apiService = _FakeApiService();
    var refreshCount = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CompanyContextPage(
              apiService: apiService,
              onConfigUpdated: () {
                refreshCount += 1;
              },
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Informacion de la Empresa'), findsOneWidget);
    expect(find.text('Phyto Emagry'), findsWidgets);
    expect(find.text('Banreservas'), findsOneWidget);
    expect(find.textContaining('Ejemplo:'), findsWidgets);

    await tester.enterText(find.byType(TextField).first, 'Phyto Emagry RD');
    await tester.enterText(
      find.widgetWithText(TextField, 'https://www.google.com/maps?q=18.486058,-69.931212'),
      'https://maps.app.goo.gl/demo123',
    );
    await tester.ensureVisible(find.widgetWithText(ElevatedButton, 'Guardar'));
    await tester.tap(find.widgetWithText(ElevatedButton, 'Guardar'));
    await tester.pumpAndSettle();

    expect(apiService.savedCompanyName, 'Phyto Emagry RD');
    expect(apiService.savedGoogleMapsLink, 'https://maps.app.goo.gl/demo123');
    expect(apiService.savedWorkingHours?['lunes_viernes'], '8:00 AM - 6:00 PM');
    expect(apiService.savedUsageRules?['send_location'], 'solo_si_cliente_la_pide');
    expect(refreshCount, 1);

    await binding.setSurfaceSize(null);
  });
}