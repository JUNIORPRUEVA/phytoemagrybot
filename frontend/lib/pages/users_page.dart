import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../widgets/secondary_page_layout.dart';

class UsersPage extends StatefulWidget {
  const UsersPage({super.key, required this.authService, required this.currentUser});

  final AuthService authService;
  final AuthUserData currentUser;

  @override
  State<UsersPage> createState() => _UsersPageState();
}

class _UsersPageState extends State<UsersPage> {
  bool _isLoading = true;
  bool _isSaving = false;
  String? _errorMessage;
  List<AuthUserData> _users = const <AuthUserData>[];

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final users = await widget.authService.listUsers();
      if (!mounted) {
        return;
      }
      setState(() {
        _users = users;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _openUserSheet({AuthUserData? user}) async {
    final nameController = TextEditingController(text: user?.name ?? '');
    final emailController = TextEditingController(text: user?.email ?? '');
    final phoneController = TextEditingController(text: user?.phone ?? '');
    final passwordController = TextEditingController();
    var role = user?.role ?? 'vendedor';
    var isActive = user?.isActive ?? true;
    final formKey = GlobalKey<FormState>();

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            8,
            20,
            MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: StatefulBuilder(
            builder: (context, setModalState) {
              return Form(
                key: formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      user == null ? 'Nuevo usuario' : 'Editar usuario',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: nameController,
                      decoration: const InputDecoration(labelText: 'Nombre'),
                      validator: (value) =>
                          (value?.trim().isEmpty ?? true) ? 'Escribe el nombre.' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: emailController,
                      decoration: const InputDecoration(labelText: 'Correo'),
                      validator: (value) {
                        final normalized = value?.trim() ?? '';
                        if (normalized.isEmpty) {
                          return 'Escribe el correo.';
                        }
                        if (!normalized.contains('@')) {
                          return 'Correo inválido.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: phoneController,
                      decoration: const InputDecoration(labelText: 'Teléfono'),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: passwordController,
                      decoration: InputDecoration(
                        labelText: user == null ? 'Contraseña' : 'Nueva contraseña (opcional)',
                      ),
                      obscureText: true,
                      validator: (value) {
                        final normalized = value?.trim() ?? '';
                        if (user == null && normalized.isEmpty) {
                          return 'Escribe la contraseña.';
                        }
                        if (normalized.isNotEmpty && normalized.length < 8) {
                          return 'Debe tener al menos 8 caracteres.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: role,
                      decoration: const InputDecoration(labelText: 'Rol'),
                      items: const <DropdownMenuItem<String>>[
                        DropdownMenuItem(value: 'admin', child: Text('Admin')),
                        DropdownMenuItem(value: 'vendedor', child: Text('Vendedor')),
                        DropdownMenuItem(value: 'soporte', child: Text('Soporte')),
                      ],
                      onChanged: (value) {
                        if (value == null) {
                          return;
                        }
                        setModalState(() {
                          role = value;
                        });
                      },
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Usuario activo'),
                      value: isActive,
                      onChanged: (value) {
                        setModalState(() {
                          isActive = value;
                        });
                      },
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: _isSaving
                          ? null
                          : () async {
                              if (!formKey.currentState!.validate()) {
                                return;
                              }

                              Navigator.of(context).pop(true);
                              setState(() {
                                _isSaving = true;
                              });

                              try {
                                if (user == null) {
                                  await widget.authService.createUser(
                                    name: nameController.text.trim(),
                                    email: emailController.text.trim(),
                                    phone: phoneController.text.trim(),
                                    password: passwordController.text.trim(),
                                    role: role,
                                    isActive: isActive,
                                  );
                                } else {
                                  await widget.authService.updateUser(
                                    id: user.id,
                                    name: nameController.text.trim(),
                                    email: emailController.text.trim(),
                                    phone: phoneController.text.trim(),
                                    password: passwordController.text.trim(),
                                    role: role,
                                    isActive: isActive,
                                  );
                                }

                                if (!mounted) {
                                  return;
                                }
                                _showMessage(user == null ? 'Usuario creado.' : 'Usuario actualizado.');
                                await _loadUsers();
                              } catch (error) {
                                if (!mounted) {
                                  return;
                                }
                                _showMessage(
                                  error.toString().replaceFirst('Exception: ', ''),
                                  isError: true,
                                );
                              } finally {
                                if (mounted) {
                                  setState(() {
                                    _isSaving = false;
                                  });
                                }
                              }
                            },
                      child: Text(user == null ? 'Crear usuario' : 'Guardar cambios'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    nameController.dispose();
    emailController.dispose();
    phoneController.dispose();
    passwordController.dispose();

    if (saved == true) {
      return;
    }
  }

  Future<void> _deleteUser(AuthUserData user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Eliminar usuario'),
          content: Text('Se desactivará y marcará como eliminado a ${user.name}.'),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Eliminar'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await widget.authService.deleteUser(user.id);
      if (!mounted) {
        return;
      }
      _showMessage('Usuario eliminado.');
      await _loadUsers();
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString().replaceFirst('Exception: ', ''), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SecondaryPageLayout(
      caption: 'Administra accesos, roles y sesiones del equipo desde un solo lugar.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Usuarios',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ),
              ElevatedButton.icon(
                onPressed: _isSaving ? null : () => _openUserSheet(),
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: const Text('Nuevo'),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_errorMessage != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Text(
                _errorMessage!,
                style: const TextStyle(
                  color: Color(0xFF991B1B),
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          else if (_isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_users.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: const Text(
                'Todavía no hay usuarios creados.',
                style: TextStyle(
                  color: Color(0xFF475569),
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          else
            Column(
              children: _users.map((user) {
                final isCurrentUser = widget.currentUser.id == user.id;

                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: const Color(0xFFEFF6FF),
                          child: Text(
                            user.name.isEmpty ? '?' : user.name.characters.first.toUpperCase(),
                            style: const TextStyle(
                              color: Color(0xFF2563EB),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Row(
                                children: <Widget>[
                                  Expanded(
                                    child: Text(
                                      user.name,
                                      style: const TextStyle(
                                        color: Color(0xFF0F172A),
                                        fontSize: 16,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                  if (isCurrentUser)
                                    const _UserChip(
                                      label: 'Tú',
                                      color: Color(0xFFDBEAFE),
                                      textColor: Color(0xFF1D4ED8),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(
                                user.email,
                                style: const TextStyle(
                                  color: Color(0xFF334155),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              if (user.phone?.isNotEmpty ?? false) ...<Widget>[
                                const SizedBox(height: 4),
                                Text(
                                  user.phone!,
                                  style: const TextStyle(color: Color(0xFF64748B)),
                                ),
                              ],
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: <Widget>[
                                  _UserChip(
                                    label: user.role,
                                    color: const Color(0xFFF1F5F9),
                                    textColor: const Color(0xFF334155),
                                  ),
                                  _UserChip(
                                    label: user.isActive ? 'Activo' : 'Inactivo',
                                    color: user.isActive
                                        ? const Color(0xFFDCFCE7)
                                        : const Color(0xFFFEE2E2),
                                    textColor: user.isActive
                                        ? const Color(0xFF166534)
                                        : const Color(0xFF991B1B),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        PopupMenuButton<String>(
                          onSelected: (value) {
                            if (value == 'edit') {
                              _openUserSheet(user: user);
                              return;
                            }
                            _deleteUser(user);
                          },
                          itemBuilder: (context) => const <PopupMenuEntry<String>>[
                            PopupMenuItem<String>(
                              value: 'edit',
                              child: Text('Editar'),
                            ),
                            PopupMenuItem<String>(
                              value: 'delete',
                              child: Text('Eliminar'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
        ],
      ),
    );
  }

  void _showMessage(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? const Color(0xFF991B1B) : const Color(0xFF0F766E),
      ),
    );
  }
}

class _UserChip extends StatelessWidget {
  const _UserChip({
    required this.label,
    required this.color,
    required this.textColor,
  });

  final String label;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: textColor,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}